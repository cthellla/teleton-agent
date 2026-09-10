/** TTS generation timeout */
export const TTS_TIMEOUT_MS = 30_000;
export const BATCH_TRIGGER_DELAY_MS = 500;
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const RETRY_DEFAULT_MAX_ATTEMPTS = 3;
export const RETRY_DEFAULT_BASE_DELAY_MS = 1_000;
export const RETRY_DEFAULT_MAX_DELAY_MS = 10_000;
export const RETRY_DEFAULT_TIMEOUT_MS = 15_000;
export const RETRY_BLOCKCHAIN_BASE_DELAY_MS = 2_000;
export const RETRY_BLOCKCHAIN_MAX_DELAY_MS = 15_000;
export const RETRY_BLOCKCHAIN_TIMEOUT_MS = 30_000;
/** Max wait for an outgoing transfer to commit on-chain (TON finality is sub-second). */
export const TON_CONFIRM_TIMEOUT_MS = 20_000;
export const TON_CONFIRM_POLL_INTERVAL_MS = 1_000;
export const GRAMJS_RETRY_DELAY_MS = 1_000;
export const GRAMJS_CONNECT_RETRY_DELAY_MS = 3_000;
export const TOOL_EXECUTION_TIMEOUT_MS = 90_000;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const TYPING_REFRESH_MS = 4_000;
/** Timeout for a single LLM API request; prevents multi-minute hangs on network issues */
export const LLM_REQUEST_TIMEOUT_MS = 60_000;
/** Timeout for streaming LLM requests (longer since response generation is incremental) */
export const LLM_STREAM_TIMEOUT_MS = 180_000;

/**
 * Fork-only: cap on the response:after hook. The hackernews plugin bills over
 * HTTP to payment_api there, and a hung call would deadlock the chat queue.
 */
export const RESPONSE_AFTER_TIMEOUT_MS = 15_000;
