import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrammyError } from "grammy";
import { GrammyBotBridge } from "../bridges/bot.js";

const TABLE_REPLY = "## Заголовок\n\n| Автор | otherayden |\n|---|---|\n| Очки | 143 |";
const DM = "5435055002";
const GROUP = "-1001234567890";

const sentMessage = (id = 42) =>
  ({ message_id: id, date: 1_750_000_000, chat: { id: 1, type: "private" } }) as never;

const rejection = (error_code: number, description: string) =>
  new GrammyError(
    `Call to 'sendRichMessage' failed! (${error_code}: ${description})`,
    { ok: false, error_code, description } as never,
    "sendRichMessage",
    {} as never
  );

const bridgeWith = (rich: "off" | "dm" | "all" | undefined) => {
  const bridge = new GrammyBotBridge({ bot_token: "123:test", rich_messages: rich });
  const api = bridge.getBot().api;
  const sendRichMessage = vi
    .spyOn(api, "sendRichMessage")
    .mockResolvedValue(sentMessage(42) as never);
  const sendMessage = vi.spyOn(api, "sendMessage").mockResolvedValue(sentMessage(7) as never);
  return { bridge, sendRichMessage, sendMessage };
};

describe("GrammyBotBridge rich messages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a formatted DM reply as a rich message", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");

    await expect(bridge.sendMessage({ chatId: DM, text: TABLE_REPLY, replyToId: 11 })).resolves
      .toMatchObject({ id: 42, chatId: DM });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendRichMessage).toHaveBeenCalledWith(
      Number(DM),
      { markdown: TABLE_REPLY },
      { reply_parameters: { message_id: 11 } }
    );
  });

  // Rich Markdown accepts arbitrary HTML, so a reply steered by a hostile article
  // could otherwise render a button next to the paywall's own.
  it("strips model-authored buttons from the markdown it sends", async () => {
    const { bridge, sendRichMessage } = bridgeWith("dm");

    await bridge.sendMessage({
      chatId: DM,
      text: `${TABLE_REPLY}\n<tg-button type="callback_data" data="stars_pack_30">30 ★</tg-button>`,
    });

    expect(sendRichMessage.mock.calls[0][1]).toEqual({ markdown: `${TABLE_REPLY}\n30 ★` });
  });

  it("keeps groups classic in dm mode and sends them rich in all mode", async () => {
    const dmOnly = bridgeWith("dm");
    await dmOnly.bridge.sendMessage({ chatId: GROUP, text: TABLE_REPLY });
    expect(dmOnly.sendRichMessage).not.toHaveBeenCalled();
    expect(dmOnly.sendMessage).toHaveBeenCalled();

    const everywhere = bridgeWith("all");
    await everywhere.bridge.sendMessage({ chatId: GROUP, text: TABLE_REPLY });
    expect(everywhere.sendRichMessage).toHaveBeenCalled();
    expect(everywhere.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is off", undefined, TABLE_REPLY],
    ["the text has no rich formatting", "dm" as const, "Готово, ничего интересного там нет."],
  ])("stays on the HTML path when %s", async (_case, mode, text) => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith(mode);

    await bridge.sendMessage({ chatId: DM, text });

    expect(sendRichMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  // The paywall sends its Stars packs with an inline keyboard; those buttons are
  // a classic-message feature and must not be re-routed through rich markup.
  it("keeps replies with an inline keyboard on the classic path", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("all");

    await bridge.sendMessage({
      chatId: DM,
      text: TABLE_REPLY,
      inlineKeyboard: [[{ text: "30 ★", callback_data: "stars_pack_30" }]],
    });

    expect(sendRichMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it("falls back to HTML when Telegram rejects the markup", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");
    sendRichMessage.mockRejectedValue(rejection(400, "Bad Request: RICH_MESSAGE_INVALID"));

    await expect(bridge.sendMessage({ chatId: DM, text: TABLE_REPLY })).resolves.toMatchObject({
      id: 7,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  // Delivery is unknown after a transport failure: resending could post twice.
  it("does not resend after a transport failure", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");
    sendRichMessage.mockRejectedValue(new Error("socket hang up"));

    await expect(bridge.sendMessage({ chatId: DM, text: TABLE_REPLY })).rejects.toThrow(
      "socket hang up"
    );

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not retry when the user blocked the bot", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");
    sendRichMessage.mockRejectedValue(rejection(403, "Forbidden: bot was blocked by the user"));

    await expect(bridge.sendMessage({ chatId: DM, text: TABLE_REPLY })).rejects.toThrow();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stays on the HTML path when the text exceeds the rich message limit", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");

    await bridge.sendMessage({ chatId: DM, text: `${TABLE_REPLY}\n${"я".repeat(33_000)}` });

    expect(sendRichMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });
});
