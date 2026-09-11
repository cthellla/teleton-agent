import { describe, expect, it } from "vitest";
import { withReasoningFlags } from "../model-reasoning.js";

type Options = Parameters<typeof withReasoningFlags>[1];

const options = (...ids: string[]): Options =>
  ids.map((value) => ({ value, name: value })) as Options;

const flags = (provider: string, ...ids: string[]): Record<string, boolean | undefined> =>
  Object.fromEntries(
    withReasoningFlags(provider, options(...ids)).map((option) => [option.value, option.reasoning])
  );

describe("withReasoningFlags", () => {
  it("reads the flag from pi-ai's registry, including OpenRouter :free ids", () => {
    const result = flags("openrouter", "qwen/qwen3.6-plus:free", "openai/gpt-4o-mini");
    expect(result["qwen/qwen3.6-plus:free"]).toBe(true);
    expect(result["openai/gpt-4o-mini"]).not.toBe(true);
  });

  // Models pi-ai 0.82.1 lacks resolve from ADDITIONAL_MODELS at runtime, so they
  // reason in production; the WebUI select must not stay disabled for them.
  it("falls back to ADDITIONAL_MODELS, keyed by Teleton provider", () => {
    expect(flags("anthropic", "claude-fable-5-1")).toEqual({ "claude-fable-5-1": true });
    expect(flags("openai", "gpt-6-astra")).toEqual({ "gpt-6-astra": true });
    expect(flags("codex", "gpt-6-astra")).toEqual({ "gpt-6-astra": true });
    expect(
      flags(
        "openrouter",
        "anthropic/claude-fable-5.1",
        "openai/gpt-6-astra",
        "google/gemini-3.8-flash"
      )
    ).toEqual({
      "anthropic/claude-fable-5.1": true,
      "openai/gpt-6-astra": true,
      "google/gemini-3.8-flash": true,
    });
  });

  it("keeps an explicit catalog value", () => {
    const [option] = withReasoningFlags("anthropic", [
      { value: "claude-fable-5-1", name: "Claude Fable 5.1", reasoning: false },
    ] as Options);
    expect(option.reasoning).toBe(false);
  });

  it("returns options unchanged for an unknown provider", () => {
    const input = options("some-model");
    expect(withReasoningFlags("not-a-provider", input)).toBe(input);
  });
});
