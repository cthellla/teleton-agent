import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger.js";
import type { TelegramMessage } from "../telegram/bridge.js";

const log = createLogger("CallbackRouter");

interface NonceEntry {
  label: string;
  chatId: string;
  expectedUserId: number;
  createdAt: number;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class CallbackRouter {
  private nonceMap = new Map<string, NonceEntry>();

  /** Register a button nonce. Returns the callback_data string "btn:[uuid]" */
  registerNonce(label: string, chatId: string, expectedUserId: number): string {
    this.cleanup();
    const uuid = randomUUID();
    const key = `btn:${uuid}`;
    this.nonceMap.set(key, { label, chatId, expectedUserId, createdAt: Date.now() });
    return key;
  }

  /** Resolve a callback. Returns synthetic TelegramMessage or null if invalid. */
  resolveCallback(
    callbackData: string,
    fromId: number,
    fromUsername: string | undefined,
    fromFirstName: string | undefined,
    chatId: string,
    isGroup: boolean
  ): TelegramMessage | null {
    this.cleanup();
    const entry = this.nonceMap.get(callbackData);
    if (!entry) {
      log.warn({ callbackData }, "Unknown or expired callback nonce");
      return null;
    }

    // Validate sender
    if (entry.expectedUserId !== fromId) {
      log.warn(
        { callbackData, expected: entry.expectedUserId, actual: fromId },
        "Callback from unexpected user"
      );
      return null;
    }

    // Single-use: delete after consumption
    this.nonceMap.delete(callbackData);

    // Build synthetic TelegramMessage — use the actual chat where the button was clicked
    return {
      id: -(Date.now() % 2_147_483_647),
      chatId,
      senderId: fromId,
      senderUsername: fromUsername,
      senderFirstName: fromFirstName,
      text: `User clicked: ${entry.label}`,
      isGroup,
      isChannel: false,
      isBot: false,
      mentionsMe: true,
      timestamp: new Date(),
      hasMedia: false,
    };
  }

  /** Clean expired nonces */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.nonceMap) {
      if (now - entry.createdAt > NONCE_TTL_MS) {
        this.nonceMap.delete(key);
      }
    }
  }
}

/** Singleton */
export const callbackRouter = new CallbackRouter();
