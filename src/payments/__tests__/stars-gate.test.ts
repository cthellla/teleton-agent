import { describe, expect, it, vi } from "vitest";
import { registerPaymentCommands } from "../stars-gate.js";

describe("registerPaymentCommands", () => {
  // grammY's command() matches a bare "/cancel" in groups too, and /cancel cancels a
  // Stars subscription with no confirmation — so these must be registered on the
  // private-chat composer, never on the root bot.
  it("registers the payment service commands for private chats only", () => {
    const dm = { command: vi.fn() };
    const bot = { chatType: vi.fn(() => dm), command: vi.fn(), api: {} };

    registerPaymentCommands(bot as unknown as Parameters<typeof registerPaymentCommands>[0]);

    expect(bot.chatType).toHaveBeenCalledWith("private");
    expect(bot.command).not.toHaveBeenCalled();
    expect(dm.command.mock.calls.map(([name]) => name).sort()).toEqual([
      "cancel",
      "paysupport",
      "terms",
    ]);
  });
});
