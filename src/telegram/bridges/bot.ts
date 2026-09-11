import {
  Bot,
  GrammyError,
  InlineKeyboard,
  InputFile,
  type Context,
  type MiddlewareFn,
} from "grammy";
import type { InlineQueryResultArticle } from "@grammyjs/types";
import { markdownToTelegramHtml } from "../formatting.js";
import {
  RICH_MESSAGE_MAX_BYTES,
  hasRichFormatting,
  richMessageBytes,
  richMessageFits,
  stripInteractiveRichMarkup,
} from "../rich-detect.js";
import { splitMessageForTelegram } from "../message-splitter.js";
import { sanitizeMarkdownForTelegram } from "../sanitize-markdown.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import { classifyMedia } from "../bridge-interface.js";
import type {
  ITelegramBridge,
  SentMessage,
  SentDiceMessage,
  SendMessageOptions,
  EditMessageOptions,
  BotInfo,
  ChatInfo,
  ReplyContext,
} from "../bridge-interface.js";
import type { TelegramMessage, InlineButton } from "../bridge.js";
import type { SuccessfulPayment } from "@grammyjs/types";
import { createLogger } from "../../utils/logger.js";
import { callbackRouter } from "../../bot/callback-router.js";
import { answerCallbackOnce } from "../../bot/callback-answer.js";

const log = createLogger("BotBridge");

interface GrammyBotBridgeConfig {
  bot_token: string;
  /** Fork-only: send replies as Rich Messages where Telegram supports them. */
  rich_messages?: RichMessageMode;
}

type RichMessageMode = "off" | "dm" | "all";

type GrammyMessage = NonNullable<Context["message"]>;

// Explicit rather than autodetected, so the delivered update set cannot silently
// shift with handler registration order. An update type missing here is never
// delivered at all — inline_query and chosen_inline_result were missing, which
// left upstream's InlineRouter (plugin inline mode) dead in bot mode.
const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "pre_checkout_query",
  "guest_message",
  "inline_query",
  "chosen_inline_result",
] as const;

const FENCE_LINE = /^[ \t]*(?:```|~~~)[^\n]*$/gm;

/**
 * Close a code fence left open at the end of a part and reopen it in the next,
 * so every part converts to valid HTML on its own. Without this, a fence longer
 * than the budget is cut in the middle and the user sees raw backticks.
 */
function reopenFences(parts: string[]): string[] {
  const balanced: string[] = [];
  let carry = "";

  for (const part of parts) {
    let text = carry ? `${carry}\n${part}` : part;
    const fences = text.match(FENCE_LINE) ?? [];
    if (fences.length % 2 === 1) {
      const opener = fences[fences.length - 1].trim();
      carry = opener;
      text = `${text}\n${opener.slice(0, 3)}`;
    } else {
      carry = "";
    }
    balanced.push(text);
  }

  return balanced;
}

/** Split markdown at the last line or word boundary before the budget. */
function splitMarkdownAt(text: string, budget: number): string[] {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > budget) {
    let cut = remaining.lastIndexOf("\n", budget);
    if (cut < budget * 0.3) cut = remaining.lastIndexOf(" ", budget);
    if (cut < budget * 0.3) cut = budget;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[ \t]+/, "");
  }
  if (remaining.length > 0) parts.push(remaining);

  return parts;
}

export class GrammyBotBridge implements ITelegramBridge {
  private bot: Bot;
  private botInfo: BotInfo | undefined;
  private connected = false;
  private botPromise: Promise<void> | undefined;
  private callbackHandler: ((msg: TelegramMessage) => void) | undefined;
  private paymentHandler:
    | ((userId: number, payment: SuccessfulPayment) => void | Promise<void>)
    | undefined;
  private paymentCallbackHandler: ((ctx: Context) => void | Promise<void>) | undefined;
  private preCheckoutHandler:
    | ((userId: number, totalAmount: number, payload: string) => void | Promise<void>)
    | undefined;
  private preMessageFilter:
    | ((
        userId: number,
        chatId: string,
        text: string,
        ctx: Context,
        isGroup: boolean,
        mentionsMe: boolean
      ) => Promise<boolean>)
    | undefined;
  private activeDraftIds: Map<string, number> = new Map();
  private readonly richMessages: RichMessageMode;

  constructor(config: GrammyBotBridgeConfig) {
    this.bot = new Bot(config.bot_token);
    this.richMessages = config.rich_messages ?? "off";

    this.bot.catch((err) => {
      log.error({ err }, "Grammy bot error");
    });
  }

  async connect(): Promise<void> {
    // Only init (fetch bot info) — polling starts after handlers are registered via startPolling()
    await this.bot.init();
    const me = this.bot.botInfo;
    this.botInfo = {
      id: me.id,
      username: me.username,
      firstName: me.first_name,
      isBot: me.is_bot,
    };
    this.connected = true;
    log.info("Grammy bot initialized (polling deferred until handlers registered)");
  }

  /** Start long-polling. Must be called AFTER onNewMessage() to avoid Grammy listener error. */
  startPolling(): void {
    this.botPromise = this.bot
      .start({
        drop_pending_updates: true,
        allowed_updates: ALLOWED_UPDATES as unknown as never[],
        onStart: () => {
          log.info("Grammy bot polling started");
        },
      })
      .catch((err) => {
        log.error({ err }, "Grammy bot polling error");
      });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.bot.stop();
  }

  getMode(): "bot" {
    return "bot";
  }

  requiresOffsetDedup(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return this.connected;
  }

  getOwnUserId(): bigint | undefined {
    return this.botInfo ? BigInt(this.botInfo.id) : undefined;
  }

  getUsername(): string | undefined {
    return this.botInfo?.username;
  }

  /**
   * Bot API 10.0: reply to a guest invocation. One-shot — the same guest_query_id
   * cannot be answered twice. The reply is delivered as an InlineQueryResultArticle
   * whose input_message_content is the actual message; the article title is not
   * shown to the user.
   *
   * NOTE: the markdown is truncated at the Telegram limit *before* HTML conversion,
   * so an expanded result can still exceed it. Pre-existing behaviour, tracked in
   * teletonhnplugin#16 — deliberately unchanged here.
   */
  async answerGuestQuery(guestQueryId: string, text: string): Promise<void> {
    const safeMd = sanitizeMarkdownForTelegram(text);
    const truncated =
      safeMd.length > TELEGRAM_MAX_MESSAGE_LENGTH
        ? safeMd.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 1) + "…"
        : safeMd;
    const html = markdownToTelegramHtml(truncated);

    const buildResult = (parseMode: "HTML" | undefined): InlineQueryResultArticle => ({
      type: "article",
      id: guestQueryId.slice(0, 64),
      title: "Reply",
      input_message_content: {
        message_text: parseMode === "HTML" ? html : truncated,
        parse_mode: parseMode,
        // Disable webpage previews — some chats forbid them (CHAT_SEND_WEBPAGE_FORBIDDEN)
        // and URLs in our text are kept for re-fetch / user navigation, not preview value.
        link_preview_options: { is_disabled: true },
      },
    });

    // GrammyError carries an enumerable `payload` holding the whole request —
    // for this method that is the user's entire answer text. Callers log errors
    // with pino's serializer, which would dump it. Rethrow narrowly instead,
    // keeping the diagnostic bits and no message body (and no URL, which embeds
    // the bot token).
    const narrow = (error: unknown): Error =>
      error instanceof GrammyError
        ? new Error(`answerGuestQuery failed (${error.error_code}): ${error.description}`)
        : error instanceof Error
          ? error
          : new Error(String(error));

    try {
      await this.bot.api.answerGuestQuery(guestQueryId, buildResult("HTML"));
    } catch (error) {
      // Same fallback as before: a model-produced entity Telegram refuses to parse
      // must not cost the user their answer — resend it unformatted.
      const description = error instanceof GrammyError ? error.description : "";
      if (description.includes("can't parse entities")) {
        log.warn(`answerGuestQuery HTML rejected, retrying as plain text: ${description}`);
        try {
          await this.bot.api.answerGuestQuery(guestQueryId, buildResult(undefined));
        } catch (retryError) {
          throw narrow(retryError);
        }
        return;
      }
      throw narrow(error);
    }
  }

  getBot(): Bot {
    return this.bot;
  }

  useMiddleware(middleware: MiddlewareFn<Context>): void {
    this.bot.use(middleware);
  }

  /**
   * Convert a decimal-string chatId to the JS number the grammy/Bot API expects.
   * The Bot API types chat ids as JS numbers; bridge-interface keeps them as
   * strings, so this is the single conversion point for the whole bridge.
   */
  private toChatId(chatId: string): number {
    return Number(chatId);
  }

  async sendMessage(options: SendMessageOptions): Promise<SentMessage> {
    if (options.rich) {
      throw new Error("Native structured Rich Messages require Telegram user mode");
    }
    if (!options.text || options.text.trim().length === 0) {
      log.debug("sendMessage skipped: empty text");
      return { id: 0, date: Math.floor(Date.now() / 1000), chatId: options.chatId };
    }

    const replyMarkup = options.inlineKeyboard?.length
      ? this.toGrammyKeyboard(options.inlineKeyboard)
      : undefined;

    if (this.shouldSendRich(options.chatId, options.text, replyMarkup !== undefined)) {
      const sent = await this.sendRichMessage(options);
      if (sent) return sent;
    }

    const html = markdownToTelegramHtml(options.text);

    // Auto-split: if HTML exceeds Telegram limit, send in chunks. The markdown
    // is split, not the HTML — cutting converted HTML leaves one part with an
    // unclosed tag and the other with an orphan closer, and Telegram 400s both.
    if (html.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      return this.sendLongMessage(options.chatId, options.text, options.replyToId, replyMarkup);
    }

    const result = await this.bot.api.sendMessage(this.toChatId(options.chatId), html, {
      parse_mode: "HTML",
      reply_to_message_id: options.replyToId,
      reply_markup: replyMarkup,
    });

    return {
      id: result.message_id,
      date: result.date,
      chatId: options.chatId,
    };
  }

  /** Split markdown that would exceed the Telegram message limit, then send each part. */
  private async sendLongMessage(
    chatId: string,
    markdown: string,
    replyToId?: number,
    replyMarkup?: InlineKeyboard
  ): Promise<SentMessage> {
    const chunks = this.splitForHtml(markdown);
    let lastResult: SentMessage = { id: 0, date: Math.floor(Date.now() / 1000), chatId };

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const result = await this.sendPart(chatId, chunks[i], {
        reply_to_message_id: isFirst ? replyToId : undefined,
        reply_markup: isLast ? replyMarkup : undefined,
      });
      lastResult = { id: result.message_id, date: result.date, chatId };
    }

    return lastResult;
  }

  /**
   * Send one converted part, and if Telegram rejects the markup, send the same
   * part as plain text. Losing the formatting beats losing the reply, which is
   * what happened before: a 400 on one part threw and the rest never went out.
   */
  private async sendPart(
    chatId: string,
    html: string,
    other: { reply_to_message_id?: number; reply_markup?: InlineKeyboard }
  ) {
    try {
      return await this.bot.api.sendMessage(this.toChatId(chatId), html, {
        parse_mode: "HTML",
        ...other,
      });
    } catch (error) {
      if (!(error instanceof GrammyError) || error.error_code !== 400) throw error;
      log.warn(`Telegram rejected a message part (${error.description}), retrying as plain text`);
      const plain = html.replace(/<[^>]+>/g, "").slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
      return await this.bot.api.sendMessage(this.toChatId(chatId), plain, other);
    }
  }

  /**
   * Split markdown into parts whose *converted* HTML fits the limit.
   *
   * A fixed markdown budget cannot work: escaping turns one "<" into "&lt;" and
   * one "&" into "&amp;", so a part full of angle brackets grows past the limit
   * after conversion, and cutting the HTML instead leaves one part with an
   * unclosed tag and the next with an orphan closer — Telegram 400s both. Each
   * part is measured after conversion and re-split when it does not fit.
   */
  private splitForHtml(markdown: string): string[] {
    return reopenFences(splitMessageForTelegram(markdown, TELEGRAM_MAX_MESSAGE_LENGTH)).flatMap(
      (part) => this.fitPart(part, 0)
    );
  }

  private fitPart(part: string, depth: number): string[] {
    const html = markdownToTelegramHtml(part);
    if (html.length <= TELEGRAM_MAX_MESSAGE_LENGTH || depth >= 8) return [html];

    // Budget from what this text actually expands to, with room to spare.
    const ratio = html.length / Math.max(1, part.length);
    const budget = Math.max(256, Math.floor((TELEGRAM_MAX_MESSAGE_LENGTH * 0.85) / ratio));
    const pieces = reopenFences(splitMarkdownAt(part, budget));
    if (pieces.length < 2) return [html];
    return pieces.flatMap((piece) => this.fitPart(piece, depth + 1));
  }

  /**
   * Rich Messages render the headings, tables and italics that the HTML subset
   * silently drops. Inline keyboards stay on the classic path: rich buttons are
   * a different markup, and the paywall's callback buttons must keep working.
   */
  private shouldSendRich(chatId: string, text: string, hasKeyboard: boolean): boolean {
    if (hasKeyboard || !this.richChat(chatId)) return false;
    if (!richMessageFits(text)) return false;
    return hasRichFormatting(text);
  }

  /** Whether this chat may receive rich messages at all, ignoring the text. */
  private richChat(chatId: string): boolean {
    if (this.richMessages === "off") return false;
    if (this.richMessages === "all") return true;
    // Private chats have positive numeric ids; "@channel" is not a DM.
    const numeric = Number(chatId);
    return Number.isFinite(numeric) && numeric > 0;
  }

  /**
   * Longest reply this bridge can deliver to the chat in one message. The caller
   * splits on it, and the two formats differ by 8x, so assuming the classic
   * limit would chop rich replies through the middle of a table.
   */
  outboundTextLimit(chatId: string, text: string): number {
    if (!this.shouldSendRich(chatId, text, false)) return TELEGRAM_MAX_MESSAGE_LENGTH;
    // The caller counts characters, Telegram counts bytes: hand back the budget
    // in the caller's units, which for Cyrillic is about half.
    const bytesPerChar = Math.max(1, richMessageBytes(text) / Math.max(1, text.length));
    return Math.floor(RICH_MESSAGE_MAX_BYTES / bytesPerChar);
  }

  /**
   * Telegram rejecting the markup means nothing was delivered, so resending it
   * as classic HTML is safe. A transport failure leaves delivery unknown and
   * must not be retried, or the user gets the same reply twice. A 403 is the
   * user blocking the bot: the classic retry would fail identically, so only a
   * 403 that is about the message itself falls back.
   */
  private static canFallbackFromRich(error: unknown): boolean {
    if (!(error instanceof GrammyError)) return false;
    if (error.error_code === 400 || error.error_code === 406) return true;
    if (error.error_code !== 403) return false;
    return !/blocked|kicked|deactivated|deleted/i.test(error.description);
  }

  /** Returns null when Telegram rejected the markup and the HTML path should take over. */
  private async sendRichMessage(options: SendMessageOptions): Promise<SentMessage | null> {
    const markdown = stripInteractiveRichMarkup(options.text);
    try {
      const result = await this.bot.api.sendRichMessage(
        this.toChatId(options.chatId),
        { markdown },
        {
          reply_parameters:
            options.replyToId !== undefined ? { message_id: options.replyToId } : undefined,
        }
      );
      return { id: result.message_id, date: result.date, chatId: options.chatId };
    } catch (error) {
      if (!GrammyBotBridge.canFallbackFromRich(error)) throw error;
      log.warn(
        `Rich message rejected (${error instanceof GrammyError ? error.description : String(error)}), falling back to HTML`
      );
      return null;
    }
  }

  async editMessage(options: EditMessageOptions): Promise<SentMessage> {
    if (options.rich) {
      throw new Error("Native structured Rich Messages require Telegram user mode");
    }
    const replyMarkup = options.inlineKeyboard?.length
      ? this.toGrammyKeyboard(options.inlineKeyboard)
      : undefined;

    const result = await this.bot.api.editMessageText(
      this.toChatId(options.chatId),
      options.messageId,
      markdownToTelegramHtml(options.text),
      { parse_mode: "HTML", reply_markup: replyMarkup }
    );

    if (typeof result === "boolean") {
      return { id: options.messageId, date: Math.floor(Date.now() / 1000), chatId: options.chatId };
    }

    return {
      id: result.message_id,
      date: result.date,
      chatId: options.chatId,
    };
  }

  async deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    await this.bot.api.deleteMessage(this.toChatId(chatId), messageId);
    return true;
  }

  async forwardMessage(
    fromChatId: string,
    toChatId: string,
    messageId: number
  ): Promise<SentMessage> {
    const result = await this.bot.api.forwardMessage(
      this.toChatId(toChatId),
      this.toChatId(fromChatId),
      messageId
    );

    return {
      id: result.message_id,
      date: result.date,
      chatId: toChatId,
    };
  }

  async sendPhoto(
    chatId: string,
    photo: string | Buffer,
    caption?: string,
    replyToId?: number
  ): Promise<SentMessage> {
    const input = Buffer.isBuffer(photo) ? new InputFile(photo) : photo;
    const result = await this.bot.api.sendPhoto(this.toChatId(chatId), input, {
      caption,
      reply_to_message_id: replyToId,
    });

    return {
      id: result.message_id,
      date: result.date,
      chatId,
    };
  }

  async pinMessage(chatId: string, messageId: number): Promise<boolean> {
    await this.bot.api.pinChatMessage(this.toChatId(chatId), messageId);
    return true;
  }

  async sendDice(chatId: string, emoji?: string): Promise<SentDiceMessage> {
    const result = await this.bot.api.sendDice(
      this.toChatId(chatId),
      emoji as Parameters<typeof this.bot.api.sendDice>[1]
    );

    return {
      id: result.message_id,
      date: result.date,
      chatId,
      value: result.dice.value,
    };
  }

  async getChatInfo(chatId: string): Promise<ChatInfo> {
    const chat = await this.bot.api.getChat(this.toChatId(chatId));

    return {
      id: String(chat.id),
      title: "title" in chat ? chat.title : undefined,
      type: chat.type as ChatInfo["type"],
      memberCount: undefined,
      description: "description" in chat ? chat.description : undefined,
      username: "username" in chat ? chat.username : undefined,
    };
  }

  async getMe(): Promise<BotInfo | undefined> {
    const me = await this.bot.api.getMe();

    return {
      id: me.id,
      username: me.username,
      firstName: me.first_name,
      isBot: me.is_bot,
    };
  }

  async setTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(this.toChatId(chatId), "typing");
    } catch {
      // 429 rate-limits on typing are harmless — swallow silently
    }
  }

  async sendReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    await this.bot.api.setMessageReaction(this.toChatId(chatId), messageId, [
      { type: "emoji", emoji } as Parameters<
        typeof this.bot.api.setMessageReaction
      >[2] extends (infer U)[]
        ? U
        : never,
    ]);
  }

  /**
   * Stream text to chat via sendMessageDraft. Does NOT send a final message —
   * the caller decides when to finalize (after all tool iterations complete).
   * When accumulated text approaches the Telegram message limit, the current
   * draft is flushed as a real message and streaming continues in a new draft.
   * Returns only the un-sent remainder (what finalizeDraft should send).
   */
  async streamDraft(chatId: string, textStream: AsyncIterable<string>): Promise<string> {
    let draftId = this.activeDraftIds.get(chatId) ?? Math.floor(Math.random() * 2147483647) + 1;
    this.activeDraftIds.set(chatId, draftId);
    let fullText = "";
    let lastDraftTime = 0;
    const THROTTLE_MS = 300;
    const numericChatId = this.toChatId(chatId);
    const richChat = this.richChat(chatId);
    // Leave headroom for HTML expansion from markdownToTelegramHtml
    const HTML_THRESHOLD = TELEGRAM_MAX_MESSAGE_LENGTH - 300;
    const RICH_THRESHOLD = RICH_MESSAGE_MAX_BYTES - 300;

    for await (const chunk of textStream) {
      fullText += chunk;
      // Don't stream silent tokens or heartbeat tokens as visible drafts
      if (fullText.trim() === "__SILENT__" || fullText.trim() === "NO_ACTION") continue;

      // Auto-split: when accumulated text nears the limit, flush as real message
      // The draft goes out in one of two formats and each has its own cap:
      // sendMessageDraft rejects anything past 4096, a rich draft past 32768.
      const rich = richChat && hasRichFormatting(fullText);
      const html = rich ? "" : markdownToTelegramHtml(fullText);
      const rendered = rich ? richMessageBytes(fullText) : html.length;
      if (rendered >= (rich ? RICH_THRESHOLD : HTML_THRESHOLD)) {
        // Clear draft bubble and send as real message
        try {
          await this.bot.api.sendMessageDraft(numericChatId, draftId, " ");
        } catch {
          /* best effort */
        }
        await this.sendMessage({ chatId, text: fullText });

        // Reset for next segment
        fullText = "";
        draftId = Math.floor(Math.random() * 2147483647) + 1;
        this.activeDraftIds.set(chatId, draftId);
        lastDraftTime = 0;
        continue;
      }

      const now = Date.now();
      if (now - lastDraftTime >= THROTTLE_MS && fullText.length > 0) {
        try {
          await this.sendDraft(numericChatId, draftId, fullText, rich, html);
        } catch {
          // Draft updates are best-effort
        }
        lastDraftTime = now;
      }
    }

    // Send one final draft update with complete text
    if (fullText.length > 0) {
      const rich = richChat && hasRichFormatting(fullText);
      try {
        await this.sendDraft(
          numericChatId,
          draftId,
          fullText,
          rich,
          rich ? "" : markdownToTelegramHtml(fullText)
        );
      } catch {
        /* best effort */
      }
    }

    return fullText;
  }

  /** One draft update, rich when the chat and the text allow it. */
  private async sendDraft(
    chatId: number,
    draftId: number,
    text: string,
    rich: boolean,
    html: string
  ): Promise<void> {
    if (rich) {
      await this.bot.api.sendRichMessageDraft(chatId, draftId, {
        markdown: stripInteractiveRichMarkup(text),
      });
      return;
    }
    await this.bot.api.sendMessageDraft(chatId, draftId, html, { parse_mode: "HTML" });
  }

  async clearDraft(chatId: string): Promise<void> {
    const draftId = this.activeDraftIds.get(chatId);
    if (draftId) {
      try {
        await this.bot.api.sendMessageDraft(this.toChatId(chatId), draftId, " ");
      } catch {
        /* best effort */
      }
      this.activeDraftIds.delete(chatId);
    }
  }

  /** Clear active draft and send the final real message */
  async finalizeDraft(chatId: string, text: string): Promise<SentMessage> {
    await this.clearDraft(chatId);
    if (!text || text.trim().length === 0) {
      return { id: 0, date: Math.floor(Date.now() / 1000), chatId };
    }
    return this.sendMessage({ chatId, text });
  }

  resetDraft(chatId: string): void {
    this.activeDraftIds.delete(chatId);
  }

  /** Stream response: draft tokens then send final message. Convenience wrapper. */
  async streamResponse(chatId: string, textStream: AsyncIterable<string>): Promise<SentMessage> {
    const text = await this.streamDraft(chatId, textStream);
    return this.finalizeDraft(chatId, text);
  }

  async getMessages(_chatId: string, _limit: number): Promise<TelegramMessage[]> {
    throw new Error(
      "getMessages is unavailable in bot mode — bots cannot read arbitrary chat history."
    );
  }

  parseMessage(msg: GrammyMessage): TelegramMessage {
    const botUsername = this.botInfo?.username?.toLowerCase();

    let mentionsMe = msg.chat.type === "private"; // DMs always count as "mentioning" the bot

    // Reply to bot's own message counts as mention
    if (msg.reply_to_message?.from?.id === this.botInfo?.id) {
      mentionsMe = true;
    }

    if (!mentionsMe && msg.entities && botUsername) {
      for (const entity of msg.entities) {
        if (entity.type === "mention") {
          const mentionText = (msg.text || "").slice(entity.offset, entity.offset + entity.length);
          if (mentionText.toLowerCase() === `@${botUsername}`) {
            mentionsMe = true;
            break;
          }
        } else if (entity.type === "bot_command") {
          const cmdText = (msg.text || "").slice(entity.offset, entity.offset + entity.length);
          const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
          // In groups, only match /command@our_bot (explicit mention required)
          // In DMs, match any command
          if (isGroup ? cmdText.toLowerCase().includes(`@${botUsername}`) : true) {
            mentionsMe = true;
            break;
          }
        }
      }
    }

    // Also check text for @botUsername without entity (some clients)
    if (!mentionsMe && botUsername && (msg.text || "").toLowerCase().includes(`@${botUsername}`)) {
      mentionsMe = true;
    }

    const { hasMedia, mediaType } = classifyMedia({
      photo: msg.photo,
      video: msg.video,
      audio: msg.audio,
      voice: msg.voice,
      sticker: msg.sticker,
      document: msg.document,
    });

    return {
      id: msg.message_id,
      chatId: String(msg.chat.id),
      senderId: msg.from?.id ?? 0,
      senderUsername: msg.from?.username,
      senderFirstName: msg.from?.first_name,
      senderLangCode: msg.from?.language_code || "en",
      text: msg.dice
        ? `[Dice: ${msg.dice.emoji} = ${msg.dice.value}]`
        : msg.text || msg.caption || "",
      isGroup: msg.chat.type === "group" || msg.chat.type === "supergroup",
      isChannel: (msg.chat.type as string) === "channel",
      isBot: msg.from?.is_bot ?? false,
      mentionsMe,
      hasMedia,
      mediaType,
      timestamp: new Date(msg.date * 1000),
      replyToId: msg.reply_to_message?.message_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bot mode stores a Grammy message where the interface types a GramJS Api.Message
      _rawMessage: msg.reply_to_message ? (msg as any) : undefined,
    };
  }

  onNewMessage(
    handler: (msg: TelegramMessage) => void | Promise<void>,
    filters?: { incoming?: boolean; outgoing?: boolean; chats?: string[] }
  ): void {
    // Bot API 10.0 Guest Mode. grammy 1.41 doesn't type `guest_message`, so we tap
    // the raw update via middleware. Must be registered BEFORE bot.on(...) below
    // to avoid grammy treating an unrecognised update as unhandled.
    this.bot.use(async (ctx, next) => {
      const guest = (ctx.update as any).guest_message as
        | (GrammyMessage & { guest_query_id?: string })
        | undefined;
      if (!guest || !guest.guest_query_id) return next();

      try {
        const parsed = this.parseMessage(guest);
        const msg: TelegramMessage = {
          ...parsed,
          mentionsMe: true, // by definition: bot was summoned
          _isGuest: true,
          _guestQueryId: guest.guest_query_id,
        };
        log.info(
          `[Guest] invocation from ${msg.senderId} in chat ${msg.chatId} (query ${guest.guest_query_id})`
        );
        await handler(msg);
      } catch (err) {
        log.error({ err }, "Error in guest_message handler");
      }
      // Don't fall through — guest_message has no body recognised by bot.on("message")
    });

    this.bot.on(
      [
        "message:text",
        "message:photo",
        "message:video",
        "message:voice",
        "message:document",
        "message:sticker",
        "message:dice",
      ],
      async (ctx) => {
        if (!ctx.message) return;

        const msg = this.parseMessage(ctx.message);

        // Bots only receive incoming messages; outgoing filter doesn't apply
        if (filters?.incoming === false) return;

        if (filters?.chats && !filters.chats.includes(msg.chatId)) return;

        // PaymentGate: block message before it reaches the debouncer/agent
        if (this.preMessageFilter) {
          try {
            const blocked = await this.preMessageFilter(
              msg.senderId,
              msg.chatId,
              msg.text,
              ctx,
              msg.isGroup,
              msg.mentionsMe
            );
            if (blocked) {
              log.info(
                `[PaymentGate] Blocked message from ${msg.senderId}${msg.isGroup ? " (group)" : ""}`
              );
              return;
            }
          } catch (err) {
            log.error({ err }, "[PaymentGate] Filter error, allowing message through");
          }
        }

        try {
          await handler(msg);
        } catch (err) {
          log.error({ err }, "Error in message handler");
        }
      }
    );

    // Pre-checkout query — must respond within 10s. Answer first, then log.
    this.bot.on("pre_checkout_query", async (ctx) => {
      try {
        await ctx.answerPreCheckoutQuery(true);
      } catch (err) {
        log.error({ err }, "Failed to answer pre_checkout_query");
      }
      // Fire-and-forget logging — never block the 10s Telegram window on a DB write.
      if (this.preCheckoutHandler) {
        const q = ctx.preCheckoutQuery;
        const userId = q?.from?.id;
        const totalAmount = q?.total_amount ?? 0;
        const payload = q?.invoice_payload ?? "";
        if (userId) {
          Promise.resolve(this.preCheckoutHandler(userId, totalAmount, payload)).catch((err) => {
            log.error({ err }, "preCheckoutHandler failed");
          });
        }
      }
    });

    // Successful payment — dispatch to payment handler if registered
    this.bot.on("message:successful_payment", async (ctx) => {
      const payment = ctx.message?.successful_payment;
      if (!payment) return;
      if (this.paymentHandler) {
        try {
          await this.paymentHandler(ctx.from.id, payment);
        } catch (err) {
          log.error({ err }, "Error in payment handler");
        }
      }
    });

    // Callback handler — resolves nonces from telegram_send_buttons, reinjects as synthetic messages
    this.bot.on("callback_query:data", async (ctx) => {
      await answerCallbackOnce(ctx);

      const data = ctx.callbackQuery.data;

      // Payment callback — credit pack purchase
      if ((data === "buy_one_answer" || data?.startsWith("pack_")) && this.paymentCallbackHandler) {
        try {
          await this.paymentCallbackHandler(ctx);
        } catch (err) {
          log.error({ err }, "Error in payment callback handler");
        }
        return;
      }

      if (data?.startsWith("btn:") && this.callbackHandler) {
        const from = ctx.callbackQuery.from;
        const chat = ctx.callbackQuery.message?.chat;
        if (chat) {
          const synthetic = callbackRouter.resolveCallback(
            data,
            from.id,
            from.username,
            from.first_name,
            String(chat.id),
            chat.type === "group" || chat.type === "supergroup"
          );
          if (synthetic) {
            this.callbackHandler(synthetic);
          }
        }
      }
    });
  }

  /** Register a handler for Bot API 10.0 guest queries. Reply text is sent via answerGuestQuery. */
  onGuestMessage(handler: (msg: TelegramMessage) => Promise<string>): void {
    this.bot.on("guest_message", async (ctx) => {
      const gm = ctx.guestMessage;
      if (!gm) return;
      try {
        const content = await handler(this.parseMessage(gm));
        const text = content?.trim();
        if (!text || text === "__SILENT__") return;
        const html = markdownToTelegramHtml(text).slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
        await ctx.answerGuestQuery({
          type: "article",
          id: String(gm.message_id),
          title: this.botInfo?.firstName ?? "Reply",
          input_message_content: { message_text: html, parse_mode: "HTML" },
        });
      } catch (err) {
        log.error({ err }, "Error in guest message handler");
      }
    });
  }

  async fetchReplyContext(rawMsg: unknown): Promise<ReplyContext | null> {
    const msg = rawMsg as GrammyMessage | undefined;
    if (!msg?.reply_to_message) return null;

    const reply = msg.reply_to_message;

    const senderName = reply.from?.first_name || reply.from?.username || undefined;

    const isAgent = this.botInfo !== undefined && reply.from?.id === this.botInfo.id;

    return {
      text: reply.text || reply.caption || undefined,
      senderName,
      isAgent,
    };
  }

  /** Set callback handler for synthetic message injection (from CallbackRouter) */
  setCallbackHandler(handler: (msg: TelegramMessage) => void): void {
    this.callbackHandler = handler;
  }

  /** Set handler for successful Star payments */
  setPaymentHandler(
    handler: (userId: number, payment: SuccessfulPayment) => void | Promise<void>
  ): void {
    this.paymentHandler = handler;
  }

  /** Set handler for payment-related callback queries (e.g. buy_one_answer) */
  setPaymentCallbackHandler(handler: (ctx: Context) => void | Promise<void>): void {
    this.paymentCallbackHandler = handler;
  }

  /**
   * Set handler for pre_checkout_query events. Fired AFTER answering Telegram —
   * useful for logging that a user reached the Stars wallet confirmation step
   * (distinguishes "abandoned at invoice" from "abandoned in Stars wallet").
   */
  setPreCheckoutHandler(
    handler: (userId: number, totalAmount: number, payload: string) => void | Promise<void>
  ): void {
    this.preCheckoutHandler = handler;
  }

  /**
   * Set a pre-message filter (PaymentGate). Runs BEFORE the message enters the
   * debouncer/agent. Return true to block the message (e.g. paywall sent).
   */
  setPreMessageFilter(
    filter: (
      userId: number,
      chatId: string,
      text: string,
      ctx: Context,
      isGroup: boolean,
      mentionsMe: boolean
    ) => Promise<boolean>
  ): void {
    this.preMessageFilter = filter;
  }

  /** Sync admin commands to Telegram's slash-command menu via setMyCommands */
  async syncCommands(): Promise<void> {
    const commands = [
      { command: "status", description: "View agent status" },
      { command: "model", description: "Switch LLM model" },
      {
        command: "reasoning",
        description: "Set reasoning effort (none/minimal/low/medium/high/xhigh/max)",
      },
      { command: "loop", description: "Set max agentic iterations" },
      { command: "policy", description: "Change access policy" },
      { command: "modules", description: "Manage module permissions" },
      { command: "plugin", description: "Manage plugin secrets" },
      { command: "wallet", description: "Check TON wallet balance" },
      { command: "verbose", description: "Toggle verbose logging" },
      { command: "rag", description: "Toggle Tool RAG or view status" },
      { command: "guest", description: "Toggle guest mode" },
      { command: "pause", description: "Pause the agent" },
      { command: "resume", description: "Resume the agent" },
      { command: "stop", description: "Emergency shutdown" },
      { command: "clear", description: "Clear conversation history" },
      { command: "ping", description: "Check if agent is responsive" },
      { command: "help", description: "Show available commands" },
      { command: "tldr", description: "Summarize an article, repo, HN story or thread by URL" },
    ];
    try {
      await this.bot.api.setMyCommands(commands);
      log.info(`Bot commands synced: ${commands.length} commands registered`);
    } catch (err) {
      log.warn({ err }, "Failed to sync bot commands");
    }
  }

  private toGrammyKeyboard(buttons: InlineButton[][]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const row of buttons) {
      for (const btn of row) {
        if (btn.url) {
          kb.url(btn.text, btn.url);
        } else if (btn.web_app) {
          kb.webApp(btn.text, btn.web_app.url);
        } else if (btn.callback_data) {
          kb.text(btn.text, btn.callback_data);
        }
      }
      kb.row();
    }
    return kb;
  }
}
