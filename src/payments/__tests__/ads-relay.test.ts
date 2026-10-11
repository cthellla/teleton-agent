import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOSED, SESSION_TTL_SEC, WELCOME, createAdsRelay } from "../ads-relay.js";

const ADMIN = 1000;
const ADVERTISER = 2000;

type Msg = Record<string, unknown> & { message_id: number };

function makeCtx(message: Msg | undefined, nextId: { n: number }) {
  const api = {
    sendMessage: vi.fn(async () => ({ message_id: nextId.n++ })),
    copyMessage: vi.fn(async () => ({ message_id: nextId.n++ })),
    setMessageReaction: vi.fn(async () => true),
  };
  return { message, api, reply: vi.fn(async () => ({})) };
}

function fromAdvertiser(id: number, extra: Record<string, unknown>): Msg {
  return {
    message_id: id,
    chat: { id: ADVERTISER, type: "private" },
    from: { id: ADVERTISER, is_bot: false, first_name: "Ann", username: "ann_ads" },
    ...extra,
  };
}

function fromAdmin(id: number, replyTo?: number): Msg {
  return {
    message_id: id,
    chat: { id: ADMIN, type: "private" },
    from: { id: ADMIN, is_bot: false, first_name: "Owner" },
    text: "Our rate is 50 TON",
    ...(replyTo !== undefined ? { reply_to_message: { message_id: replyTo } } : {}),
  };
}

describe("createAdsRelay", () => {
  let dir: string;
  let dbPath: string;
  let clock: number;
  const ids = { n: 500 };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ads-relay-"));
    dbPath = join(dir, "plugin.db");
    clock = 1_800_000_000;
    ids.n = 500;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const relay = (adminId: number | undefined = ADMIN) =>
    createAdsRelay({ dbPath, adminId, now: () => clock });

  const call = (
    r: ReturnType<typeof relay>,
    uid: number,
    text: string,
    ctx: any,
    isGroup = false
  ) => r(uid, String(uid), text, ctx, isGroup);

  async function openSession(r: ReturnType<typeof relay>) {
    const ctx = makeCtx(fromAdvertiser(1, { text: "/start ads" }), ids);
    expect(await call(r, ADVERTISER, "/start ads", ctx)).toBe(true);
    return ctx;
  }

  it("does nothing without an admin, in groups, or for users with no session", async () => {
    const msg = fromAdvertiser(1, { text: "/start ads" });
    // Not relay(undefined): a default parameter would swap undefined for ADMIN.
    const noAdmin = createAdsRelay({ dbPath, adminId: undefined, now: () => clock });
    expect(await call(noAdmin, ADVERTISER, "/start ads", makeCtx(msg, ids))).toBe(false);
    expect(await call(relay(), ADVERTISER, "/start ads", makeCtx(msg, ids), true)).toBe(false);

    const plain = makeCtx(fromAdvertiser(2, { text: "hello" }), ids);
    expect(await call(relay(), ADVERTISER, "hello", plain)).toBe(false);
    expect(plain.api.sendMessage).not.toHaveBeenCalled();
  });

  it("opens a session on /start ads: welcomes the user and notifies the admin", async () => {
    const ctx = await openSession(relay());
    expect(ctx.reply).toHaveBeenCalledWith(WELCOME);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      ADMIN,
      expect.stringContaining("New ads inquiry from Ann @ann_ads (id 2000)")
    );
  });

  it("relays advertiser text to the admin with a sender header and keeps it from the agent", async () => {
    const r = relay();
    await openSession(r);
    const ctx = makeCtx(fromAdvertiser(2, { text: "I want a pinned post next week" }), ids);

    expect(await call(r, ADVERTISER, "I want a pinned post next week", ctx)).toBe(true);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      ADMIN,
      "📣 Ann @ann_ads (id 2000):\n\nI want a pinned post next week"
    );
  });

  it("delivers the admin's reply to a relayed message back to the advertiser", async () => {
    const r = relay();
    await openSession(r);
    const relayed = makeCtx(fromAdvertiser(2, { text: "price?" }), ids);
    await call(r, ADVERTISER, "price?", relayed);
    const relayedId = (await relayed.api.sendMessage.mock.results[0].value).message_id;

    const reply = makeCtx(fromAdmin(77, relayedId), ids);
    expect(await call(r, ADMIN, "Our rate is 50 TON", reply)).toBe(true);
    expect(reply.api.copyMessage).toHaveBeenCalledWith(ADVERTISER, ADMIN, 77);
    expect(reply.api.setMessageReaction).toHaveBeenCalled();
  });

  it("lets the admin's own messages reach the agent unless they reply to a relayed one", async () => {
    const r = relay();
    await openSession(r);
    expect(await call(r, ADMIN, "status?", makeCtx(fromAdmin(80), ids))).toBe(false);
    expect(await call(r, ADMIN, "status?", makeCtx(fromAdmin(81, 99999), ids))).toBe(false);
  });

  it("closes on /done, after which messages go to the agent again", async () => {
    const r = relay();
    await openSession(r);
    const done = makeCtx(fromAdvertiser(3, { text: "/done" }), ids);
    expect(await call(r, ADVERTISER, "/done", done)).toBe(true);
    expect(done.reply).toHaveBeenCalledWith(CLOSED);

    expect(
      await call(r, ADVERTISER, "hi again", makeCtx(fromAdvertiser(4, { text: "hi again" }), ids))
    ).toBe(false);
  });

  it("leaves the relay when the user sends another command, such as a story button", async () => {
    const r = relay();
    await openSession(r);
    const story = makeCtx(fromAdvertiser(5, { text: "/start story_123" }), ids);
    expect(await call(r, ADVERTISER, "/start story_123", story)).toBe(false);
    expect(story.api.sendMessage).not.toHaveBeenCalled();
    expect(
      await call(r, ADVERTISER, "and now?", makeCtx(fromAdvertiser(6, { text: "and now?" }), ids))
    ).toBe(false);
  });

  it("expires a session nobody touched for a week", async () => {
    const r = relay();
    await openSession(r);
    clock += SESSION_TTL_SEC + 1;
    expect(
      await call(r, ADVERTISER, "late", makeCtx(fromAdvertiser(7, { text: "late" }), ids))
    ).toBe(false);
  });

  it("reopens a closed session when the admin answers, so the advertiser's reply comes back", async () => {
    const r = relay();
    await openSession(r);
    const relayed = makeCtx(fromAdvertiser(2, { text: "price?" }), ids);
    await call(r, ADVERTISER, "price?", relayed);
    const relayedId = (await relayed.api.sendMessage.mock.results[0].value).message_id;
    await call(r, ADVERTISER, "/done", makeCtx(fromAdvertiser(3, { text: "/done" }), ids));

    await call(r, ADMIN, "Our rate is 50 TON", makeCtx(fromAdmin(78, relayedId), ids));
    const back = makeCtx(fromAdvertiser(8, { text: "deal" }), ids);
    expect(await call(r, ADVERTISER, "deal", back)).toBe(true);
    expect(back.api.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining("deal"));
  });

  it("copies media with the sender header in the caption", async () => {
    const r = relay();
    await openSession(r);
    const photo = makeCtx(
      fromAdvertiser(9, { photo: [{ file_id: "x" }], caption: "our banner" }),
      ids
    );
    expect(await call(r, ADVERTISER, "our banner", photo)).toBe(true);
    expect(photo.api.copyMessage).toHaveBeenCalledWith(ADMIN, ADVERTISER, 9, {
      caption: "📣 Ann @ann_ads (id 2000):\n\nour banner",
    });
  });

  it("sends the header separately when text plus header would exceed Telegram's limit", async () => {
    const r = relay();
    await openSession(r);
    const long = "x".repeat(4090);
    const ctx = makeCtx(fromAdvertiser(10, { text: long }), ids);
    expect(await call(r, ADVERTISER, long, ctx)).toBe(true);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(ADMIN, "📣 Ann @ann_ads (id 2000):");
    expect(ctx.api.copyMessage).toHaveBeenCalledWith(ADMIN, ADVERTISER, 10);
  });

  it("stores state in the plugin DB tables", async () => {
    await openSession(relay());
    const db = new Database(dbPath);
    try {
      const row = db
        .prepare("SELECT closed_at FROM ads_relay_sessions WHERE user_id = ?")
        .get("2000");
      expect(row).toEqual({ closed_at: null });
    } finally {
      db.close();
    }
  });
});
