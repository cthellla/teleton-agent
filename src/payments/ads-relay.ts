/**
 * Ads relay (fork-only).
 *
 * Advertisers reach the owner through the bot instead of a personal account:
 * t.me/<bot>?start=ads opens a relay session, every message the advertiser
 * sends is copied to the admin, and the admin's reply to a relayed message is
 * copied back. The agent sees neither side.
 *
 * Runs inside the PaymentGate pre-message filter, ahead of the paywall: an
 * advertiser who already used the free requests must still reach the owner,
 * and the owner's replies must not be read as prompts.
 *
 * State lives in the hackernews plugin DB next to the payment tables.
 */

import Database from "better-sqlite3";
import type { Context } from "grammy";
import type { Message } from "grammy/types";

import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

export const ADS_START = /^\/start\s+ads\b/i;
const DONE = /^\/done\b/i;

/** A session nobody touched for this long hands the user back to the agent. */
export const SESSION_TTL_SEC = 7 * 86400;

/** Telegram caps: 4096 characters for a text message, 1024 for a caption. */
const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;

export const WELCOME =
  "👋 Hi! You're talking to the Hacker News Insights team.\n\n" +
  "Tell us what you'd like to promote: a link to your channel or product, the format " +
  "(your own post, a repost, a pinned post) and the dates you have in mind. " +
  "We'll reply right here.\n\n" +
  "Send /done when you're finished.";

export const CLOSED = "Thanks! This conversation is closed — open the ads link again any time.";

const CAPTIONABLE = ["photo", "video", "document", "audio", "animation", "voice"] as const;

export type AdsRelayFilter = (
  userId: number,
  chatId: string,
  text: string,
  ctx: Context,
  isGroup: boolean
) => Promise<boolean>;

export interface AdsRelayOptions {
  dbPath: string;
  /** Who receives inquiries and answers them. Unset disables the relay. */
  adminId: number | undefined;
  /** Seconds since epoch; injectable for tests. */
  now?: () => number;
}

export function ensureAdsRelaySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ads_relay_sessions (
      user_id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      last_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ads_relay_messages (
      admin_msg_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function who(msg: Message): string {
  const from = msg.from;
  if (!from) return "unknown sender";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  const handle = from.username ? ` @${from.username}` : "";
  return `${name}${handle} (id ${from.id})`;
}

function openSession(db: Database.Database, uid: string, now: number): void {
  db.prepare(
    `INSERT INTO ads_relay_sessions (user_id, started_at, last_at, closed_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(user_id) DO UPDATE SET last_at = excluded.last_at, closed_at = NULL`
  ).run(uid, now, now);
}

function closeSession(db: Database.Database, uid: string, now: number): void {
  db.prepare("UPDATE ads_relay_sessions SET closed_at = ? WHERE user_id = ?").run(now, uid);
}

function remember(db: Database.Database, adminMsgId: number, uid: string, now: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO ads_relay_messages (admin_msg_id, user_id, created_at) VALUES (?, ?, ?)"
  ).run(adminMsgId, uid, now);
}

/**
 * Copy one advertiser message to the admin with a "who is this" header. The
 * header goes into the same message when it fits Telegram's limits; otherwise
 * it is sent separately and the original copied untouched — truncating someone's
 * ad brief would be worse than two messages.
 */
async function forwardToAdmin(ctx: Context, msg: Message, adminId: number): Promise<number[]> {
  const header = `📣 ${who(msg)}:`;

  if (msg.text !== undefined) {
    const combined = `${header}\n\n${msg.text}`;
    if (combined.length <= TEXT_LIMIT) {
      return [(await ctx.api.sendMessage(adminId, combined)).message_id];
    }
  } else if (CAPTIONABLE.some((kind) => msg[kind] !== undefined)) {
    const caption = msg.caption ? `${header}\n\n${msg.caption}` : header;
    if (caption.length <= CAPTION_LIMIT) {
      const copied = await ctx.api.copyMessage(adminId, msg.chat.id, msg.message_id, { caption });
      return [copied.message_id];
    }
  }

  const head = await ctx.api.sendMessage(adminId, header);
  const copied = await ctx.api.copyMessage(adminId, msg.chat.id, msg.message_id);
  return [head.message_id, copied.message_id];
}

export function createAdsRelay(opts: AdsRelayOptions): AdsRelayFilter {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  async function adminReply(db: Database.Database, ctx: Context, msg: Message): Promise<boolean> {
    const replyTo = msg.reply_to_message?.message_id;
    if (replyTo === undefined) return false;
    const row = db
      .prepare("SELECT user_id FROM ads_relay_messages WHERE admin_msg_id = ?")
      .get(replyTo) as { user_id: string } | undefined;
    if (!row) return false;

    try {
      await ctx.api.copyMessage(Number(row.user_id), msg.chat.id, msg.message_id);
    } catch (err) {
      log.warn({ err }, `[AdsRelay] Reply to ${row.user_id} not delivered`);
      const reason = err instanceof Error ? err.message : String(err);
      await ctx
        .reply(`⚠️ Not delivered: ${reason}`, {
          reply_parameters: { message_id: msg.message_id },
        })
        .catch(() => {});
      return true;
    }

    // The advertiser may have sent /done or let the session lapse; an answer
    // reopens it so whatever they say next comes back here, not to the agent.
    openSession(db, row.user_id, now());
    await ctx.api
      .setMessageReaction(msg.chat.id, msg.message_id, [{ type: "emoji", emoji: "👍" }])
      .catch(() => {});
    log.info(`[AdsRelay] Admin reply delivered to ${row.user_id}`);
    return true;
  }

  async function advertiser(
    db: Database.Database,
    ctx: Context,
    msg: Message,
    userId: number,
    text: string,
    adminId: number
  ): Promise<boolean> {
    const uid = String(userId);
    const t = now();

    if (ADS_START.test(text)) {
      openSession(db, uid, t);
      await ctx.reply(WELCOME);
      const note = await ctx.api.sendMessage(
        adminId,
        `📣 New ads inquiry from ${who(msg)}.\nReply to their messages to answer them.`
      );
      remember(db, note.message_id, uid, t);
      log.info(`[AdsRelay] Session opened by ${uid}`);
      return true;
    }

    const session = db
      .prepare("SELECT last_at FROM ads_relay_sessions WHERE user_id = ? AND closed_at IS NULL")
      .get(uid) as { last_at: number } | undefined;
    if (!session || t - session.last_at > SESSION_TTL_SEC) return false;

    if (DONE.test(text)) {
      closeSession(db, uid, t);
      await ctx.reply(CLOSED);
      await ctx.api.sendMessage(adminId, `📣 ${who(msg)} closed the conversation.`).catch(() => {});
      log.info(`[AdsRelay] Session closed by ${uid}`);
      return true;
    }

    // Any other command — a story button from the channel, /help — means the
    // user wants the bot itself; leave the relay instead of swallowing it.
    if (text.startsWith("/")) {
      closeSession(db, uid, t);
      return false;
    }

    try {
      const ids = await forwardToAdmin(ctx, msg, adminId);
      for (const id of ids) remember(db, id, uid, t);
    } catch (err) {
      log.error({ err }, `[AdsRelay] Message from ${uid} not relayed`);
      await ctx
        .reply("Sorry, that message didn't go through. Please try again in a few minutes.")
        .catch(() => {});
      return true;
    }
    db.prepare("UPDATE ads_relay_sessions SET last_at = ? WHERE user_id = ?").run(t, uid);
    return true;
  }

  return async function adsRelay(userId, _chatId, text, ctx, isGroup) {
    const adminId = opts.adminId;
    const msg = ctx.message;
    if (!adminId || isGroup || !msg) return false;

    const db = new Database(opts.dbPath);
    try {
      ensureAdsRelaySchema(db);
      if (userId === adminId) return await adminReply(db, ctx, msg);
      return await advertiser(db, ctx, msg, userId, text ?? "", adminId);
    } finally {
      db.close();
    }
  };
}
