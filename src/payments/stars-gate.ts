/**
 * Stars payments + PaymentGate wiring (fork-only).
 *
 * Extracted from TeletonApp so upstream's app/ refactors don't collide with it.
 * Owns: successful_payment / pre_checkout handlers, the free-tier paywall
 * pre-message filter, and the composite-PK migration for the plugin DB tables
 * (stars_credits, pending_messages, invoice_events).
 *
 * Accesses the hackernews plugin DB directly at
 * $TELETON_HOME/plugins/data/hackernews.db.
 */

import Database from "better-sqlite3";

import type { GrammyBotBridge } from "../telegram/bridges/bot.js";
import type { TelegramMessage } from "../telegram/bridge-interface.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

/** Resolved at call time, like the original in-function constant. */
function pluginDbPath(): string {
  return `${process.env.TELETON_HOME || "/data"}/plugins/data/hackernews.db`;
}

/**
 * Payment service commands: /cancel, /terms, /paysupport.
 *
 * Must be registered before the bridge's catch-all text handler (onNewMessage),
 * which does not call next(). grammY runs middleware in registration order, so
 * registered after it these never fire and the command text reaches the LLM.
 * Registered for private chats only (see below). Call once per bot instance —
 * command() appends, it does not replace.
 */
export function registerPaymentCommands(bot: ReturnType<GrammyBotBridge["getBot"]>): void {
  const PLUGIN_DB_PATH = pluginDbPath();
  // Private chats only. grammY's command() matches a bare "/cancel" in groups too
  // (only "/cancel@otherbot" is skipped), so a subscriber typing /cancel in a group
  // for some other bot would cancel their Stars subscription with no confirmation.
  // Non-private updates fall through to the regular handler, which already ignores
  // commands not addressed to this bot.
  const dm = bot.chatType("private");

  dm.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    let db: Database.Database | null = null;
    try {
      const Database = (await import("better-sqlite3")).default;
      db = new Database(PLUGIN_DB_PATH);
      const now = Math.floor(Date.now() / 1000);
      const activeSub = db
        .prepare(
          "SELECT tier, telegram_charge_id, expires_at FROM stars_subscriptions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
        )
        .get(String(userId), now) as
        | { tier: string; telegram_charge_id: string; expires_at: number }
        | undefined;

      if (!activeSub) {
        await ctx.reply("You don't have an active subscription.");
        return;
      }

      await bot.api.editUserStarSubscription(userId, activeSub.telegram_charge_id, true);
      const expiresDate = new Date(activeSub.expires_at * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      await ctx.reply(
        `Your ${activeSub.tier.charAt(0).toUpperCase() + activeSub.tier.slice(1)} subscription has been cancelled. It stays active until ${expiresDate}. You can re-subscribe anytime.`
      );
      log.info(`[stars] User ${userId} cancelled ${activeSub.tier} subscription`);
    } catch (err) {
      log.error({ err }, `[stars] /cancel error for user ${userId}`);
      await ctx
        .reply("Failed to cancel subscription. Please try again or contact /paysupport.")
        .catch(() => {});
    } finally {
      try {
        db?.close();
      } catch {
        /* */
      }
    }
  });

  dm.command("terms", async (ctx) => {
    await ctx.reply(
      "Echo Bot — Terms of Service\n\n" +
        "• Echo is an AI research assistant. Responses are AI-generated and may contain errors.\n" +
        "• Subscription payments are processed via Telegram Stars. Refunds are handled on a case-by-case basis.\n" +
        "• TON payment channels use on-chain smart contracts. Unused funds are refundable via cooperative close.\n" +
        "• Data we store: user ID, usage counters, payment records, and language preference. Data is used solely for billing, rate limiting, and service delivery. No personal data is shared with third parties.\n" +
        "• By making a purchase, you agree to these terms.\n" +
        "• For payment issues, use /paysupport."
    );
  });

  dm.command("paysupport", async (ctx) => {
    await ctx.reply(
      "For payment issues:\n\n" +
        "• Stars subscription: Use /cancel to cancel, or contact @cthellla\n" +
        "• TON payment channel: Open the Mini App to manage your channel\n" +
        "• Refund requests: Contact @cthellla with your Telegram user ID\n\n" +
        "⚠️ Telegram support cannot help with purchases made via this bot. All payment issues are handled directly by the bot developer."
    );
  });
}

/**
 * @param bridge        the grammY bot bridge to attach handlers to
 * @param replayMessage replays a message through the normal pipeline after a
 *                      successful payment (was `this.handleSingleMessage`)
 */
export function wireStarsPayments(
  bridge: GrammyBotBridge,
  replayMessage: (message: TelegramMessage) => Promise<void>
): void {
  const PLUGIN_DB_PATH = pluginDbPath();
  const bot = bridge.getBot();
  let _dbMigrated = false;
  function ensureMigration(db: Database.Database): void {
    if (_dbMigrated) return;
    // Enable WAL mode + busy timeout to prevent SQLITE_BUSY with concurrent connections
    try {
      db.pragma("journal_mode = WAL");
    } catch {
      /* */
    }
    try {
      db.pragma("busy_timeout = 5000");
    } catch {
      /* */
    }
    try {
      const cols = db.prepare("PRAGMA table_info(stars_credits)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "chat_id")) {
        db.exec(
          "DROP TABLE IF EXISTS stars_credits; CREATE TABLE stars_credits (user_id TEXT NOT NULL, chat_id TEXT NOT NULL DEFAULT '', credits INTEGER NOT NULL DEFAULT 0, last_purchase_at INTEGER, PRIMARY KEY (user_id, chat_id))"
        );
        db.exec(
          "DROP TABLE IF EXISTS pending_messages; CREATE TABLE pending_messages (user_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_text TEXT NOT NULL DEFAULT '', deep_link_param TEXT, paywall_message_id INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, chat_id))"
        );
        log.info("[PaymentGate] Migrated DB to composite PK");
      }
    } catch {
      /* table may not exist yet — plugin migrate() will create it */
    }
    // Invoice tracking for conversion analytics
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS invoice_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, event TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL)"
      );
    } catch {
      /* */
    }
    _dbMigrated = true;
  }

  // Generate invoice links on first call (lazy)
  const invoiceLinks: { basic?: string; pro?: string } = {};
  const getInvoiceLinks = async () => {
    if (invoiceLinks.basic) return invoiceLinks;
    try {
      invoiceLinks.basic = await bot.api.createInvoiceLink(
        "Echo Basic",
        "10 requests per day",
        "sub_basic",
        "",
        "XTR",
        [{ label: "Monthly", amount: 200 }],
        { subscription_period: 2592000 }
      );
      invoiceLinks.pro = await bot.api.createInvoiceLink(
        "Echo Pro",
        "30 requests per day",
        "sub_pro",
        "",
        "XTR",
        [{ label: "Monthly", amount: 400 }],
        { subscription_period: 2592000 }
      );
      log.info(`[stars] Invoice links generated: basic=${invoiceLinks.basic?.slice(0, 40)}...`);
    } catch (err) {
      log.error({ err }, "[stars] Failed to generate invoice links");
    }
    return invoiceLinks;
  };

  // Pre-checkout logging — fired when user clicks "Pay" in the Stars wallet
  // (AFTER they saw the invoice and tapped the actual confirm button). Logging
  // this distinguishes "abandoned at invoice card" (sent, no pre_checkout)
  // from "abandoned in Stars wallet" (pre_checkout, no paid).
  bridge.setPreCheckoutHandler(async (userId, totalAmount, payload) => {
    let db: Database.Database | null = null;
    try {
      const Database = (await import("better-sqlite3")).default;
      db = new Database(PLUGIN_DB_PATH);
      ensureMigration(db);
      db.prepare(
        "INSERT INTO invoice_events (user_id, chat_id, event, amount, created_at) VALUES (?, ?, 'pre_checkout', ?, ?)"
      ).run(String(userId), String(userId), totalAmount, Math.floor(Date.now() / 1000));
      log.info(`[stars] pre_checkout from ${userId}: ${totalAmount}★ payload=${payload}`);
    } catch (err) {
      log.error({ err }, "[stars] failed to log pre_checkout");
    } finally {
      try {
        db?.close();
      } catch {
        /* */
      }
    }
  });

  // Successful payment handler
  bridge.setPaymentHandler(async (userId, payment) => {
    let db: Database.Database | null = null;
    try {
      const Database = (await import("better-sqlite3")).default;
      db = new Database(PLUGIN_DB_PATH);
      ensureMigration(db);
    } catch (err) {
      log.error({ err }, "[stars] Cannot open plugin DB");
      return;
    }

    try {
      const payload = payment.invoice_payload;
      const chargeId = payment.telegram_payment_charge_id;

      if (payment.is_first_recurring) {
        // New subscription
        const tier = payload === "sub_pro" ? "pro" : "basic";
        const dailyLimit = tier === "pro" ? 30 : 10;
        const expiresAt =
          payment.subscription_expiration_date || Math.floor(Date.now() / 1000) + 2592000;

        // Cancel other active subscriptions for this user
        const existing = db
          .prepare(
            "SELECT telegram_charge_id FROM stars_subscriptions WHERE user_id = ? AND expires_at > ?"
          )
          .all(String(userId), Math.floor(Date.now() / 1000));
        for (const sub of existing) {
          try {
            await bot.api.editUserStarSubscription(
              userId,
              (sub as { telegram_charge_id: string }).telegram_charge_id,
              true
            );
            log.info(`[stars] Cancelled old subscription for user ${userId}`);
          } catch {
            /* may already be cancelled */
          }
        }

        db.prepare(
          `INSERT INTO stars_subscriptions (user_id, tier, daily_limit, expires_at, telegram_charge_id, invoice_payload)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(String(userId), tier, dailyLimit, expiresAt, chargeId, payload);

        // Reset usage counter so user gets full daily limit
        db.prepare("DELETE FROM usage_tracking WHERE user_id = ?").run(String(userId));

        log.info(`[stars] New ${tier} subscription for user ${userId}, expires ${expiresAt}`);
      } else if (payment.is_recurring) {
        // Renewal
        const expiresAt =
          payment.subscription_expiration_date || Math.floor(Date.now() / 1000) + 2592000;
        db.prepare(
          "UPDATE stars_subscriptions SET expires_at = ?, telegram_charge_id = ? WHERE user_id = ? AND invoice_payload = ?"
        ).run(expiresAt, chargeId, String(userId), payload);
        log.info(`[stars] Renewed subscription for user ${userId}, new expires ${expiresAt}`);
      } else {
        // One-off purchase (credit pack) — determine credits from payload
        const packCredits: Record<string, number> = {
          pack_1: 1,
          pack_3: 3,
          pack_5: 5,
          single_answer: 1, // backward compat
        };
        const creditsToAdd = packCredits[payload] || 1;
        log.info(
          `[stars] Credit pack "${payload}" for user ${userId}: +${creditsToAdd} credits (${payment.total_amount}★)`
        );
        try {
          db.prepare(
            "INSERT INTO invoice_events (user_id, chat_id, event, amount, created_at) VALUES (?, ?, 'paid', ?, ?)"
          ).run(
            String(userId),
            String(userId),
            payment.total_amount || 0,
            Math.floor(Date.now() / 1000)
          );
        } catch {
          /* */
        }
      }

      // Find pending message (may have multiple — DM + group). Use most recent.
      const pending = db
        .prepare(
          "SELECT * FROM pending_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
        )
        .get(String(userId)) as
        | {
            chat_id: string;
            message_text: string;
            deep_link_param: string | null;
            paywall_message_id: number | null;
          }
        | undefined;

      // For one-off purchase: credit the specific chat where pending lives
      const packCreditsMap: Record<string, number> = {
        pack_1: 1,
        pack_3: 3,
        pack_5: 5,
        single_answer: 1,
        buy_one_answer: 1,
      };
      const creditsN =
        !payment.is_first_recurring && !payment.is_recurring ? packCreditsMap[payload] || 1 : 0;
      if (creditsN > 0 && pending) {
        const now = Math.floor(Date.now() / 1000);
        db.prepare(
          `INSERT INTO stars_credits (user_id, chat_id, credits, last_purchase_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, chat_id) DO UPDATE SET credits = credits + ?, last_purchase_at = ?`
        ).run(String(userId), pending.chat_id, creditsN, now, creditsN, now);
      } else if (creditsN > 0) {
        // No pending — credit to DM (chat_id = userId in Telegram DMs)
        const now = Math.floor(Date.now() / 1000);
        db.prepare(
          `INSERT INTO stars_credits (user_id, chat_id, credits, last_purchase_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, chat_id) DO UPDATE SET credits = credits + ?, last_purchase_at = ?`
        ).run(String(userId), String(userId), creditsN, now, creditsN, now);
      }
      if (pending?.paywall_message_id) {
        try {
          await bot.api.deleteMessage(Number(pending.chat_id), pending.paywall_message_id);
        } catch {
          /* */
        }
      }
      const invoice = pendingInvoices.get(userId);
      if (invoice) {
        try {
          await bot.api.deleteMessage(invoice.chatId, invoice.messageId);
        } catch {
          /* */
        }
        pendingInvoices.delete(userId);
      }

      // Replay pending message
      if (pending) {
        db.prepare("DELETE FROM pending_messages WHERE user_id = ? AND chat_id = ?").run(
          String(userId),
          pending.chat_id
        );
        // Reset group notify throttle so next group message shows paywall again
        db.prepare("DELETE FROM pending_messages WHERE user_id = ?").run(`group_notify_${userId}`);
        const replayText = pending.deep_link_param
          ? `/start ${pending.deep_link_param}`
          : pending.message_text;

        // Call handleSingleMessage directly — bypass debouncer to avoid
        // group debounce/chatQueue issues with synthetic messages
        const isGroupChat = pending.chat_id.startsWith("-");
        const replayId = -(Date.now() % 1000000); // unique negative id for dedup
        const syntheticMsg: TelegramMessage = {
          id: replayId,
          text: replayText,
          senderId: userId,
          chatId: pending.chat_id,
          isGroup: isGroupChat,
          isChannel: false,
          isBot: false,
          mentionsMe: true,
          timestamp: new Date(),
          hasMedia: false,
        };
        log.info(
          `[stars] Replaying pending message for user ${userId}: "${replayText.slice(0, 50)}"`
        );
        // Use await for replay so chatQueue can serialize properly
        // (void caused fire-and-forget which deadlocked chatQueue)
        try {
          await replayMessage(syntheticMsg);
        } catch (replayErr) {
          log.error({ err: replayErr }, `[stars] Replay failed for user ${userId}`);
        }
      }
    } catch (err) {
      log.error({ err }, `[stars] Payment handler error for user ${userId}`);
    } finally {
      try {
        db?.close();
      } catch (err) {
        log.warn({ err }, "[stars] DB close failed");
      }
    }
  });

  // Credit pack callback handler
  const TEST_USER_IDS = new Set([130552640, 5435055002]);
  const pendingInvoices = new Map<number, { chatId: number; messageId: number }>();

  // Pack definitions: { payload, credits, stars, testStars }
  const CREDIT_PACKS: Record<string, { credits: number; stars: number; testStars: number }> = {
    pack_1: { credits: 1, stars: 10, testStars: 1 },
    pack_3: { credits: 3, stars: 20, testStars: 2 },
    pack_5: { credits: 5, stars: 30, testStars: 3 },
    buy_one_answer: { credits: 1, stars: 10, testStars: 1 }, // backward compat
  };

  bridge.setPaymentCallbackHandler(async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id;
    const userId = ctx.from?.id;
    const data = ctx.callbackQuery?.data;
    if (!chatId || !userId || !data) return;

    const pack = CREDIT_PACKS[data];
    if (!pack) return;

    const isTest = TEST_USER_IDS.has(userId);
    const amount = isTest ? pack.testStars : pack.stars;
    const label = pack.credits === 1 ? "1 Answer" : `${pack.credits} Answers`;

    try {
      const sent = await bot.api.sendInvoice(
        chatId,
        label,
        `Get ${pack.credits} answer${pack.credits > 1 ? "s" : ""} to your questions`,
        data, // payload = pack_1, pack_3, pack_5
        "XTR",
        [{ label, amount }]
      );
      pendingInvoices.set(userId, { chatId, messageId: sent.message_id });

      // Track invoice sent
      try {
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(PLUGIN_DB_PATH);
        db.prepare(
          "INSERT INTO invoice_events (user_id, chat_id, event, amount, created_at) VALUES (?, ?, 'sent', ?, ?)"
        ).run(String(userId), String(chatId), amount, Math.floor(Date.now() / 1000));
        db.close();
      } catch {
        /* */
      }
    } catch (err) {
      log.error({ err }, "[stars] Failed to send invoice");
    }
  });

  // Expose deleteMessage for plugin use in bot mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__botDeleteMessage = (chatId: number, msgId: number) =>
    bot.api.deleteMessage(chatId, msgId);

  // Cache invoice links (async, non-blocking)
  void getInvoiceLinks().then((links) => {
    // Store in env for plugin to use in paywall buttons
    if (links.basic) process.env.STARS_BASIC_LINK = links.basic;
    if (links.pro) process.env.STARS_PRO_LINK = links.pro;
  });

  // ── PaymentGate: pre-message filter ────────────────────────────
  // Runs BEFORE debouncer/agent. Returns true to block the message.
  const FREE_LIMIT = parseInt(process.env.HN_FREE_LIMIT || "3");
  const FREE_WINDOW_SEC = parseInt(process.env.HN_FREE_WINDOW_SEC || "86400");
  const adminIds = (process.env.ADMIN_IDS || "").split(",").map(Number).filter(Boolean);
  const miniAppUrl =
    process.env.PAYMENT_MINIAPP_URL ||
    `https://t.me/${process.env.SUBSCRIPTION_BOT_USERNAME || "hn_premium_bot"}/pay`;

  const paymentApiUrl = process.env.PAYMENT_API_URL || "http://payment_api:3000";
  const paymentApiKey = process.env.PAYMENT_API_KEY || "";

  async function checkTonBalance(
    uid: number
  ): Promise<{ hasChannel: boolean; canAfford?: boolean }> {
    try {
      const res = await fetch(`${paymentApiUrl}/api/internal/balance/${uid}`, {
        headers: { "X-API-Key": paymentApiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { hasChannel: false };
      return (await res.json()) as { hasChannel: boolean; canAfford?: boolean };
    } catch {
      return { hasChannel: false };
    }
  }

  bridge.setPreMessageFilter(async (userId, chatId, text, _ctx, isGroup, mentionsMe) => {
    // Service deep links — don't rate-limit
    if (text?.startsWith("/start pay")) return true; // miniapp deep link, silently drop

    // Admins always pass
    if (adminIds.includes(userId)) return false;

    let db: Database.Database | null = null;
    try {
      const Database = (await import("better-sqlite3")).default;
      db = new Database(PLUGIN_DB_PATH);
      ensureMigration(db);

      const uid = String(userId);
      const now = Math.floor(Date.now() / 1000);

      // Priority 1: Stars subscription (within daily limit)
      const starsSub = db
        .prepare(
          "SELECT daily_limit FROM stars_subscriptions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
        )
        .get(uid, now) as { daily_limit: number } | undefined;
      if (starsSub) {
        const cutoff = now - 86400;
        const used = (
          db
            .prepare(
              "SELECT COUNT(*) as cnt FROM usage_tracking WHERE user_id = ? AND created_at > ?"
            )
            .get(uid, cutoff) as { cnt: number }
        ).cnt;
        if (used < starsSub.daily_limit) return false; // within limit
        // Stars limit exhausted — fall through to TON
      }

      // Priority 2: TON payment channel (fallback for exhausted Stars, or standalone premium)
      const tonBal = await checkTonBalance(userId);
      if (tonBal.hasChannel && tonBal.canAfford) return false; // premium, plugin bills in response:after

      // Priority 3: Stars credits (per-chat)
      const credits =
        (
          db
            .prepare("SELECT credits FROM stars_credits WHERE user_id = ? AND chat_id = ?")
            .get(uid, chatId) as { credits: number } | undefined
        )?.credits || 0;
      if (credits > 0) return false; // has credits, plugin will decrement

      // Groups: only process if bot is mentioned/replied to (otherwise analyzeMessage will filter out)
      if (isGroup && !mentionsMe) {
        return false; // not mentioned, skip PaymentGate
      }

      // Groups: free users allowed (free model), same as DM
      if (isGroup) {
        return false;
      }

      // Priority 4: Free tier (DM only)
      const cutoff = now - FREE_WINDOW_SEC;
      const freeUsed = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM usage_tracking WHERE user_id = ? AND created_at > ?"
          )
          .get(uid, cutoff) as { cnt: number }
      ).cnt;
      if (freeUsed < FREE_LIMIT) return false; // within free tier

      // Over all limits — send paywall and BLOCK
      // Delete old paywall (anti-spam)
      const pending = db
        .prepare(
          "SELECT paywall_message_id FROM pending_messages WHERE user_id = ? AND chat_id = ?"
        )
        .get(uid, chatId) as { paywall_message_id: number | null } | undefined;
      if (pending?.paywall_message_id) {
        try {
          await bot.api.deleteMessage(Number(chatId), pending.paywall_message_id);
        } catch {
          /* may be deleted */
        }
      }

      // Save pending message
      const deepLinkParam = (text || "").match(/^\/start\s+(\S+)/)?.[1] || null;
      db.prepare(
        "INSERT OR REPLACE INTO pending_messages (user_id, chat_id, message_text, deep_link_param, paywall_message_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
      ).run(uid, chatId, text || "", deepLinkParam, now);

      // Detect language for localized paywall
      const userLang = (
        db.prepare("SELECT lang FROM user_lang WHERE user_id = ?").get(uid) as
          | { lang: string }
          | undefined
      )?.lang;
      const paywallI18n: Record<
        string,
        { text: string; btn: string; title: string; desc: string }
      > = {
        ru: {
          text: "Бесплатный запрос на сегодня использован.\nОплатите ⭐ за ответ ниже, или откройте TON-канал для безлимита:",
          btn: "💎 Безлимит с TON",
          title: "Один ответ",
          desc: "Ответ на ваш последний вопрос",
        },
        ar: {
          text: "تم استخدام طلبك المجاني لهذا اليوم.\nادفع ⭐ للحصول على إجابة أدناه، أو افتح قناة TON للاستخدام غير المحدود:",
          btn: "💎 غير محدود مع TON",
          title: "إجابة واحدة",
          desc: "احصل على إجابة لسؤالك الأخير",
        },
        de: {
          text: "Deine kostenlose Anfrage für heute ist aufgebraucht.\nBezahle ⭐ für eine Antwort unten, oder eröffne einen TON-Kanal für unbegrenzte Nutzung:",
          btn: "💎 Unbegrenzt mit TON",
          title: "Eine Antwort",
          desc: "Antwort auf deine letzte Frage",
        },
        fr: {
          text: "Votre requête gratuite du jour est épuisée.\nPayez ⭐ pour une réponse ci-dessous, ou ouvrez un canal TON pour un usage illimité :",
          btn: "💎 Illimité avec TON",
          title: "Une réponse",
          desc: "Réponse à votre dernière question",
        },
      };
      const defaultI18n = {
        text: "Your free request for today is used.\nPay ⭐ for an answer below, or open a TON channel for unlimited use:",
        btn: "💎 Unlimited with TON",
        title: "One Answer",
        desc: "Get an answer to your last question",
      };
      const i18n = (userLang && paywallI18n[userLang]) || defaultI18n;

      // Credit packs: answers / stars (test users get 1/2/3★)
      const isTest = TEST_USER_IDS.has(userId);
      const packs = isTest
        ? [
            { id: "pack_1", n: 1, stars: 1 },
            { id: "pack_3", n: 3, stars: 2 },
            { id: "pack_5", n: 5, stars: 3 },
          ]
        : [
            { id: "pack_1", n: 1, stars: 10 },
            { id: "pack_3", n: 3, stars: 20 },
            { id: "pack_5", n: 5, stars: 30 },
          ];

      // Send paywall with credit pack buttons + TON alternative
      const sent = await bot.api.sendMessage(Number(chatId), i18n.text, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `⭐ ${packs[0].n} answer — ${packs[0].stars}★`,
                callback_data: packs[0].id,
              },
              {
                text: `⭐ ${packs[1].n} answers — ${packs[1].stars}★ (-33%)`,
                callback_data: packs[1].id,
              },
            ],
            [
              {
                text: `⭐ ${packs[2].n} answers — ${packs[2].stars}★ (-40%)`,
                callback_data: packs[2].id,
              },
              { text: i18n.btn, url: miniAppUrl },
            ],
          ],
        },
      });

      try {
        db.prepare(
          "INSERT INTO invoice_events (user_id, chat_id, event, amount, created_at) VALUES (?, ?, 'shown', 0, ?)"
        ).run(uid, chatId, now);
      } catch {
        /* */
      }

      // Save paywall message ID for delete+send pattern
      db.prepare(
        "UPDATE pending_messages SET paywall_message_id = ? WHERE user_id = ? AND chat_id = ?"
      ).run(sent.message_id, uid, chatId);

      log.info(`[PaymentGate] Paywall sent to ${userId}, message blocked`);
      return true; // BLOCK
    } catch (err) {
      log.error({ err }, "[PaymentGate] Error, allowing message through");
      return false; // fail open
    } finally {
      try {
        db?.close();
      } catch {
        /* */
      }
    }
  });
}
