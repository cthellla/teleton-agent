import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Fork invariants that upstream merges have silently undone before.
 *
 * Each of these was lost at least once in the v0.11.2 merge while the build,
 * typecheck and the rest of this suite stayed green — the behaviour is correct
 * in isolation, it just is not the fork's. These are deliberately source-level
 * assertions: they exist to fail loudly on the next merge, not to test logic.
 * If one fails after a merge, re-apply the fork behaviour rather than updating
 * the expectation.
 */
const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("fork invariants", () => {
  it("keeps other chats' messages out of group and guest prompts", () => {
    const prep = src("../turn-preparation.ts");
    expect(prep).toMatch(/searchAllChats:\s*!effectiveIsGroup/);
    expect(prep).not.toMatch(/searchAllChats:\s*true/);
    expect(prep).toMatch(/includeMemory:\s*!effectiveIsGroup/);
  });

  it("treats guest turns as group turns", () => {
    expect(src("../../telegram/handlers.ts")).toMatch(/isGroup:\s*true,\s*isGuest:\s*true/);
  });

  it("registers payment service commands for private chats only", () => {
    const gate = src("../../payments/stars-gate.ts");
    expect(gate).toMatch(/bot\.chatType\("private"\)/);
    expect(gate).not.toMatch(/\bbot\.command\(/);
  });

  it("forwards reasoning effort to reasoning models on every provider", () => {
    expect(src("../model-request.ts")).toMatch(
      /model\.reasoning\s*&&\s*reasoningEffort\s*&&\s*reasoningEffort\s*!==\s*"none"/
    );
  });

  it("caps per-request LLM timeouts instead of using them as fallbacks", () => {
    const client = src("../client.ts");
    expect(client).toMatch(
      /Math\.min\(\s*options\.timeoutMs \?\? LLM_REQUEST_TIMEOUT_MS,\s*LLM_REQUEST_TIMEOUT_MS\s*\)/
    );
    expect(client).toMatch(
      /Math\.min\(\s*options\.timeoutMs \?\? LLM_STREAM_TIMEOUT_MS,\s*LLM_STREAM_TIMEOUT_MS\s*\)/
    );
  });

  it("keeps the thrown-network and empty-response retries in the loop", () => {
    const loop = src("../loop/executor.ts");
    expect(loop).toMatch(/NETWORK_ERROR_MAX_RETRIES/);
    expect(loop).toMatch(/EMPTY_RESPONSE_MAX_RETRIES/);
  });

  it("bounds a whole LLM request with a deadline signal, not only timeoutMs", () => {
    const client = src("../client.ts");
    expect(client).toMatch(/AbortSignal\.any\(/);
    expect(client.match(/signal:\s*withRequestDeadline\(options\.signal/g)).toHaveLength(2);
  });
});
