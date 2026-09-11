import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";
import { LLM_REQUEST_TIMEOUT_MS } from "../../constants/timeouts.js";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), stream: vi.fn() }));

vi.mock("@earendil-works/pi-ai/compat", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>(
    "@earendil-works/pi-ai/compat"
  );
  return { ...actual, complete: mocks.complete, stream: mocks.stream };
});

import { chatWithContext } from "../client.js";

const reply = {
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "ok" }],
  api: "anthropic-messages" as const,
  provider: "anthropic" as const,
  model: "claude-haiku-4-5-20251001",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

const config = AgentConfigSchema.parse({
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  api_key: "test-key",
});

describe("LLM request timeout", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.complete.mockResolvedValue(reply);
  });

  // The agent loop passes its whole remaining turn budget (300s by default) as
  // timeoutMs. Used as a fallback the 60s limit never applied, so one stalled
  // request could hold the chat queue for the entire turn.
  it("caps a caller timeout above the per-request limit", async () => {
    await chatWithContext(config, { context: { messages: [] }, timeoutMs: 300_000 });
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ timeoutMs: LLM_REQUEST_TIMEOUT_MS });
  });

  it("keeps a caller timeout that is already shorter", async () => {
    await chatWithContext(config, { context: { messages: [] }, timeoutMs: 5_000 });
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ timeoutMs: 5_000 });
  });

  it("applies the per-request limit when the caller passes none", async () => {
    await chatWithContext(config, { context: { messages: [] } });
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ timeoutMs: LLM_REQUEST_TIMEOUT_MS });
  });

  // timeoutMs alone is cancelled once response headers arrive, so it cannot stop a
  // stream that stalls mid-body. The request must also carry a deadline signal that
  // still follows the caller's own signal.
  it("passes a deadline signal that also follows the caller's signal", async () => {
    const caller = new AbortController();
    await chatWithContext(config, { context: { messages: [] }, signal: caller.signal });
    const passed = mocks.complete.mock.calls[0][2].signal as AbortSignal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed).not.toBe(caller.signal);
    expect(passed.aborted).toBe(false);
    caller.abort();
    expect(passed.aborted).toBe(true);
  });
});
