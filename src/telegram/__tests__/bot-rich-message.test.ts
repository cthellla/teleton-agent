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

    await expect(
      bridge.sendMessage({ chatId: DM, text: TABLE_REPLY, replyToId: 11 })
    ).resolves.toMatchObject({ id: 42, chatId: DM });

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

  // Telegram counts the limit in bytes: 20000 Cyrillic characters are 40000.
  it("counts the rich limit in bytes, not characters", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");

    const cyrillic = `${TABLE_REPLY}\n${"я".repeat(20_000)}`;
    expect(cyrillic.length).toBeLessThan(32_768);
    await bridge.sendMessage({ chatId: DM, text: cyrillic });

    expect(sendRichMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  // Falling back puts the whole long reply on the classic path. Escaping expands
  // the text — "<" becomes "&lt;", "&" becomes "&amp;" — so a part that fit as
  // markdown can overflow as HTML, and cutting HTML leaves half a tag behind.
  const balanced = (part: string) => {
    const count = (re: RegExp) => (part.match(re) ?? []).length;
    expect(count(/<pre>/g)).toBe(count(/<\/pre>/g));
    expect(count(/<code[ >]/g)).toBe(count(/<\/code>/g));
    expect(count(/<blockquote[ >]/g)).toBe(count(/<\/blockquote>/g));
    expect(part.length).toBeLessThanOrEqual(4096);
  };

  it.each([
    [
      "an html fence full of angle brackets",
      `## Отчёт\n\n\`\`\`html\n${'<div class="row"><span>cell</span></div>\n'.repeat(80)}\`\`\`\nконец`,
    ],
    [
      "shell ampersands",
      `## Сборка\n\n\`\`\`sh\n${"npm ci && npm test && echo ok\n".repeat(160)}\`\`\`\n`,
    ],
    [
      "one fence longer than the budget",
      `## Код\n\n\`\`\`js\n${"const value = compute(a, b);\n".repeat(260)}\`\`\`\n`,
    ],
    [
      "prose and a quote around a fence",
      `## Разбор\n\n> цитата из треда\n\n${"Русский абзац про статью. ".repeat(120)}\n\n\`\`\`c\n${"if (a < b && c > d) { run(); }\n".repeat(90)}\`\`\`\n`,
    ],
  ])("splits a long fallback reply with %s into valid parts", async (_case, text) => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");
    sendRichMessage.mockRejectedValue(rejection(400, "Bad Request: RICH_MESSAGE_INVALID"));

    await bridge.sendMessage({ chatId: DM, text });

    const parts = sendMessage.mock.calls.map((call) => call[1] as string);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach(balanced);
    // Guard against a vacuous pass: the code must survive as real formatting.
    expect(parts.some((part) => part.includes("<pre>"))).toBe(true);
    expect(parts.join("")).not.toContain("\`\`\`");
  });

  // A rejected part used to throw and take the rest of the reply with it.
  it("retries a rejected part as plain text instead of losing the reply", async () => {
    const { bridge, sendRichMessage, sendMessage } = bridgeWith("dm");
    sendRichMessage.mockRejectedValue(rejection(400, "Bad Request: RICH_MESSAGE_INVALID"));
    sendMessage
      .mockRejectedValueOnce(rejection(400, "Bad Request: can't parse entities"))
      .mockResolvedValue(sentMessage(9) as never);

    const long = `## Заголовок\n\n${"Русский абзац про статью. ".repeat(400)}`;
    await bridge.sendMessage({ chatId: DM, text: long });

    const retry = sendMessage.mock.calls[1];
    expect(retry[1]).not.toMatch(/<[a-z]/i);
    expect((retry[2] as { parse_mode?: string } | undefined)?.parse_mode).toBeUndefined();
  });
});

describe("GrammyBotBridge rich drafts and limits", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const streamOf = async function* (...chunks: string[]) {
    for (const chunk of chunks) yield chunk;
  };

  it("streams a formatted reply as a rich draft", async () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test", rich_messages: "dm" });
    const richDraft = vi
      .spyOn(bridge.getBot().api, "sendRichMessageDraft")
      .mockResolvedValue(true as never);
    const htmlDraft = vi
      .spyOn(bridge.getBot().api, "sendMessageDraft")
      .mockResolvedValue(true as never);

    await bridge.streamDraft(DM, streamOf(TABLE_REPLY));

    expect(richDraft).toHaveBeenCalled();
    expect(richDraft.mock.calls[0][2]).toEqual({ markdown: TABLE_REPLY });
    expect(htmlDraft).not.toHaveBeenCalled();
  });

  // The chat allows rich, but plain text streams as a classic draft, and those
  // are capped at 4096 — a threshold taken from the chat type would let the
  // draft grow to 32768 and every update would fail with 400.
  it("flushes a plain draft at the classic limit even in a rich chat", async () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test", rich_messages: "dm" });
    vi.spyOn(bridge.getBot().api, "sendMessageDraft").mockResolvedValue(true as never);
    const sendMessage = vi
      .spyOn(bridge.getBot().api, "sendMessage")
      .mockResolvedValue(sentMessage(7) as never);

    const remainder = await bridge.streamDraft(DM, streamOf("я".repeat(5000)));

    // The flush itself may split again: what matters is that it happened at all,
    // instead of the draft growing to the rich limit in a classic-draft chat.
    expect(sendMessage).toHaveBeenCalled();
    expect(remainder).toBe("");
  });

  it("reports the limit of the format it will actually use", () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test", rich_messages: "dm" });

    expect(bridge.outboundTextLimit(DM, TABLE_REPLY)).toBeGreaterThan(16_000);
    // Cyrillic costs two bytes per character, so the budget in characters halves.
    expect(bridge.outboundTextLimit(DM, `## Заголовок\n${"я".repeat(100)}`)).toBeLessThan(20_000);
    expect(bridge.outboundTextLimit(DM, "обычный ответ без разметки")).toBe(4096);
    expect(bridge.outboundTextLimit(GROUP, TABLE_REPLY)).toBe(4096);
  });

  it("does not treat a username chat id as a private chat", () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test", rich_messages: "dm" });

    expect(bridge.outboundTextLimit("@hackernws", TABLE_REPLY)).toBe(4096);
  });
});
