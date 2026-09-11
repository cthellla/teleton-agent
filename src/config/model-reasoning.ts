import { getModel } from "@earendil-works/pi-ai/compat";
import { ADDITIONAL_MODELS } from "../providers/additional-models.js";
import { getProviderMetadata, type SupportedProvider } from "./providers.js";
import type { getModelsForProvider } from "./model-catalog.js";

type ModelOptions = ReturnType<typeof getModelsForProvider>;

/**
 * Fork-only: attach the `reasoning` capability flag to model options.
 *
 * The WebUI Reasoning select is enabled only for reasoning models and reads this
 * flag. Upstream's v0.11.2 catalog no longer carries it (the fork's catalog had it
 * on 16 models), so the select was permanently disabled. The flag comes from
 * pi-ai's own model registry, which stays current as models change, rather than a
 * hand-maintained list, then from ADDITIONAL_MODELS for models pi-ai 0.82.1 lacks —
 * the same fallback the runtime resolver uses. An explicit catalog value still wins.
 */
export function withReasoningFlags(provider: string, models: ModelOptions): ModelOptions {
  let piAiProvider: string;
  try {
    piAiProvider = getProviderMetadata(provider as SupportedProvider).piAiProvider;
  } catch {
    return models;
  }
  return models.map((option) =>
    option.reasoning !== undefined
      ? option
      : { ...option, reasoning: lookupReasoning(provider, piAiProvider, option.value) }
  );
}

function lookupReasoning(
  provider: string,
  piAiProvider: string,
  modelId: string
): boolean | undefined {
  const find = (id: string): { reasoning?: boolean } | undefined => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getModel needs literal provider/model types
      const native = getModel(piAiProvider as any, id as any) as
        | { reasoning?: boolean }
        | undefined;
      // Keyed by Teleton provider, as in model-resolver: native entries win.
      return native ?? ADDITIONAL_MODELS[`${provider}:${id}`];
    } catch {
      return ADDITIONAL_MODELS[`${provider}:${id}`];
    }
  };
  // OpenRouter lists ":free" and paid variants under one catalog id; try both.
  const model =
    find(modelId) ??
    (modelId.endsWith(":free") ? find(modelId.slice(0, -":free".length)) : find(`${modelId}:free`));
  return model?.reasoning;
}
