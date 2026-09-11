import type { Context } from "@earendil-works/pi-ai";
import type { Config } from "../../config/schema.js";
import { getProviderMetadata } from "../../config/providers.js";
import { EMPTY_RESPONSE_MAX_RETRIES, NETWORK_ERROR_MAX_RETRIES } from "../../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../../constants/tools.js";
import { maskOldToolResults } from "../../memory/observation-masking.js";
import type { createHookRunner } from "../../sdk/hooks/runner.js";
import { isBotBridge } from "../../telegram/bridge-guards.js";
import { createLogger } from "../../utils/logger.js";
import { resolveModelTarget } from "../model-target.js";
import { resolveProviderFallback } from "../provider-fallback.js";
import { addUsage, isNetworkError } from "../runtime-utils.js";
import type { CompletedToolCall } from "../telegram-send-state.js";
import { enforceProviderToolLimit } from "../tool-selector.js";
import type { AgentTurnTraceRecorder } from "../turn-trace.js";
import type { LoopResult, ProcessMessageOptions, TurnContext } from "../turn-types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { recoverLlmError, runModelIteration } from "./llm-iteration.js";
import { executeToolBatch, injectDiscoveredTools, recordToolResults } from "./tool-batch.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export interface AgentLoopDependencies {
  config: Config;
  toolRegistry: ToolRegistry | null;
  hookRunner?: HookRunner;
}

export async function executeAgentLoop(
  turn: TurnContext,
  opts: ProcessMessageOptions,
  trace: AgentTurnTraceRecorder,
  deps: AgentLoopDependencies
): Promise<LoopResult> {
  const { chatId, effectiveIsGroup, processStartTime, systemPrompt, userMsg, sessionKey } = turn;
  const { toolContext } = opts;
  let session = turn.session;
  let context = turn.context;
  let activeProvider = turn.provider;
  let activeAgentConfig = deps.config.agent;
  let activeTools = turn.tools ? [...turn.tools] : undefined;
  let fallbackIndex = 0;

  const maxIterations = Math.max(1, deps.config.agent.max_agentic_iterations || 5);
  const maxDurationMs = Math.max(10_000, deps.config.agent.max_turn_duration_ms);
  const providerSignal = AbortSignal.timeout(
    Math.max(1, maxDurationMs - (Date.now() - processStartTime))
  );
  let iteration = 0;
  const retry = { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 };
  // Fork-only retry budgets the upstream loop does not have (lost in the v0.11.2
  // merge): thrown network/timeout errors and empty model responses.
  let networkErrorRetries = 0;
  let emptyResponseRetries = 0;
  let finalResponse: LoopResult["finalResponse"] = null;
  let lastResponse: LoopResult["finalResponse"] = null;
  let stopReason = "completed";
  let forcedContent: string | undefined;
  const totalToolCalls: CompletedToolCall[] = [];
  const accumulatedTexts: string[] = [];
  const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };
  let wasStreamed = false;
  let streamAccumulatedText = "";

  while (iteration < maxIterations) {
    if (Date.now() - processStartTime >= maxDurationMs) {
      if (!lastResponse) {
        throw new Error("Agent turn time budget exhausted before the first model response");
      }
      stopReason = "time_budget";
      forcedContent =
        "I stopped at a safe boundary because this turn reached its time budget. " +
        "Send a follow-up to continue.";
      finalResponse = lastResponse;
      break;
    }

    iteration++;
    log.debug(`Agentic iteration ${iteration}/${maxIterations}`);

    const iterationStartIndex = context.messages.length;
    const maskedMessages = maskOldToolResults(context.messages, {
      toolRegistry: deps.toolRegistry ?? undefined,
      currentIterationStartIndex: iterationStartIndex,
    });
    const maskedContext: Context = { ...context, messages: maskedMessages };

    let iterationResult: Awaited<ReturnType<typeof runModelIteration>>;
    try {
      iterationResult = await runModelIteration(
        activeAgentConfig,
        opts.streamToChat,
        maskedContext,
        systemPrompt,
        session.sessionId,
        activeTools,
        streamAccumulatedText,
        providerSignal,
        Math.max(1, maxDurationMs - (Date.now() - processStartTime))
      );
    } catch (error) {
      // Thrown transport failures (fetch failed, ECONNRESET, a request timeout)
      // never reach recoverLlmError, which only sees stopReason:"error" responses.
      // isNetworkError also matches AbortError/TimeoutError, and the turn-budget
      // signal stays aborted once it fires — so never retry after that.
      if (
        isNetworkError(error) &&
        !providerSignal.aborted &&
        networkErrorRetries < NETWORK_ERROR_MAX_RETRIES
      ) {
        networkErrorRetries++;
        const delay = 2000 * 2 ** (networkErrorRetries - 1);
        log.warn(
          `Network error (thrown), retrying in ${delay}ms (attempt ${networkErrorRetries}/${NETWORK_ERROR_MAX_RETRIES}): ${error instanceof Error ? error.message : String(error)}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        iteration--;
        continue;
      }
      throw error;
    }
    const response = iterationResult.response;
    lastResponse = response;
    const streamed = iterationResult.streamed;
    streamAccumulatedText = iterationResult.streamAccumulatedText;

    const assistantMsg = response.message;
    const iterUsage = response.message.usage;
    if (iterUsage) addUsage(accumulatedUsage, iterUsage);

    if (assistantMsg.stopReason === "error") {
      try {
        const recovered = await recoverLlmError(
          activeAgentConfig,
          deps.hookRunner,
          assistantMsg,
          retry,
          {
            session,
            context,
            chatId,
            sessionKey,
            effectiveIsGroup,
            provider: activeProvider,
            processStartTime,
            userMsg,
          }
        );
        session = recovered.session;
        context = recovered.context;
        iteration--;
        continue;
      } catch (error) {
        const actionAlreadyAttempted = totalToolCalls.some(
          (call) =>
            call.attempted !== false &&
            deps.toolRegistry?.getToolCategory(call.name) !== "data-bearing"
        );
        const previousProvider = activeProvider;
        const previousModel = activeAgentConfig.model;
        const fallback = resolveProviderFallback(
          deps.config.agent,
          fallbackIndex,
          assistantMsg.errorMessage || "",
          actionAlreadyAttempted
        );
        if (!fallback) throw error;

        fallbackIndex = fallback.nextIndex;
        activeProvider = fallback.provider;
        activeAgentConfig = fallback.config;
        const fallbackTarget = resolveModelTarget(activeProvider, activeAgentConfig.model);
        trace.updateTarget(
          activeProvider,
          fallbackTarget.resolvedModel,
          fallbackTarget.endpointFingerprint
        );
        retry.overflowResets = 0;
        retry.rateLimitRetries = 0;
        retry.serverErrorRetries = 0;
        const fallbackLimit = getProviderMetadata(activeProvider).toolLimit;
        if (activeTools) activeTools = enforceProviderToolLimit(activeTools, fallbackLimit);
        streamAccumulatedText = "";
        if (opts.streamToChat && isBotBridge(opts.streamToChat.bridge)) {
          await opts.streamToChat.bridge.clearDraft(opts.streamToChat.chatId);
        }
        log.warn(
          `Provider fallback: ${previousProvider}/${previousModel} → ` +
            `${activeProvider}/${activeAgentConfig.model}`
        );
        iteration--;
        continue;
      }
    }

    if (response.text) accumulatedTexts.push(response.text);
    const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

    if (toolCalls.length === 0) {
      // No text and zero output tokens is almost always a provider glitch, not an
      // answer. Retry instead of handing the user silence.
      const iterOutput = response.message.usage?.output ?? 0;
      if (
        !response.text &&
        iterOutput === 0 &&
        !providerSignal.aborted &&
        emptyResponseRetries < EMPTY_RESPONSE_MAX_RETRIES
      ) {
        emptyResponseRetries++;
        const delay = 2000 * emptyResponseRetries;
        log.warn(
          `Empty response with 0 output tokens, retrying in ${delay}ms (attempt ${emptyResponseRetries}/${EMPTY_RESPONSE_MAX_RETRIES})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        iteration--;
        continue;
      }
      log.info(`${iteration}/${maxIterations} → done`);
      finalResponse = response;
      wasStreamed = streamed;
      stopReason = fallbackIndex > 0 ? "completed_with_fallback" : "completed";
      break;
    }

    if (!deps.toolRegistry || !toolContext) {
      log.error("Cannot execute tools: registry or context missing");
      break;
    }

    log.debug(`Executing ${toolCalls.length} tool call(s)`);
    context.messages.push(response.message);
    const iterationToolNames: string[] = [];
    const fullContext: ToolContext = {
      ...toolContext,
      chatId,
      isGroup: effectiveIsGroup,
      isGuest: opts.isGuest,
      turnId: turn.turnId,
      sessionId: session.sessionId,
    };

    const { toolPlans, execResults } = await executeToolBatch(
      deps.toolRegistry,
      deps.hookRunner,
      toolCalls,
      fullContext,
      chatId,
      effectiveIsGroup
    );

    if (activeTools) {
      const injected = injectDiscoveredTools(
        toolPlans,
        execResults,
        activeTools,
        getProviderMetadata(activeProvider).toolLimit,
        opts.isGuest ? TELEGRAM_SEND_TOOLS : undefined
      );
      if (injected > 0) {
        log.info(
          `ToolSearch: injected ${injected} tool(s) mid-loop (total: ${activeTools.length})`
        );
      }
    }

    const resultMessages = await recordToolResults(deps.hookRunner, toolPlans, execResults, {
      totalToolCalls,
      iterationToolNames,
      sessionId: session.sessionId,
      chatId,
      effectiveIsGroup,
      db: fullContext.db,
    });
    for (const resultMsg of resultMessages) context.messages.push(resultMsg);

    trace.progress(totalToolCalls, iteration, accumulatedUsage);
    log.info(`${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

    if (Date.now() - processStartTime >= maxDurationMs) {
      stopReason = "time_budget";
      forcedContent =
        "I stopped at a safe boundary because this turn reached its time budget. " +
        "Send a follow-up to continue.";
      finalResponse = response;
      break;
    }
    if (iteration === maxIterations) {
      log.info(`Max iterations reached (${maxIterations})`);
      finalResponse = response;
      stopReason = "iteration_budget";
      forcedContent =
        "I stopped at a safe boundary because this turn reached its iteration budget. " +
        "Send a follow-up to continue.";
    }
  }

  if (finalResponse && !context.messages.includes(finalResponse.message)) {
    context.messages.push(finalResponse.message);
  }

  return {
    finalResponse,
    session,
    context,
    totalToolCalls,
    accumulatedTexts,
    accumulatedUsage,
    wasStreamed,
    iterations: iteration,
    stopReason,
    activeProvider,
    activeModel: lastResponse?.message.model ?? activeAgentConfig.model,
    forcedContent,
  };
}
