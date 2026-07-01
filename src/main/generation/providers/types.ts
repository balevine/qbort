import type { ProviderId } from '@shared/types'

/** Token usage reported by a provider for one call. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface GenerateBatchArgs {
  /** The fully compiled prompt for this batch. */
  compiledPrompt: string
  /**
   * Optional split of `compiledPrompt` into a static prefix (identical across batches:
   * editable prompt + schema + roster) and a small per-batch dynamic suffix (batch count,
   * per-ticket response targets). Providers that support prompt caching (Anthropic) cache
   * the static prefix to cut input cost across batches; others just use `compiledPrompt`.
   */
  staticPrefix?: string
  dynamicSuffix?: string
  /** How many tickets this batch should produce (used to size max output tokens). */
  count: number
  /** Preferred `max_tokens` budget for this batch. Falls back to a per-count heuristic. */
  maxOutputTokens?: number
  signal?: AbortSignal
  /** Optional streaming callback: invoked with the running output-token count. */
  onToken?: (info: { outputTokens: number }) => void
}

export interface GenerateBatchResult {
  /** The parsed JSON value the model returned (validated downstream in the orchestrator). */
  raw: unknown
  usage: TokenUsage
}

/** A single LLM provider adapter. All network calls happen in the main process. */
export interface LLMProvider {
  readonly id: ProviderId
  readonly model: string
  generateBatch(args: GenerateBatchArgs): Promise<GenerateBatchResult>
}

/** Error raised by a provider adapter; `retryable` drives the orchestrator's backoff. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status?: number,
    readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Rate limits (429) and server errors (5xx) are worth retrying. */
export function isRetryableStatus(status?: number): boolean {
  return status === 429 || (status !== undefined && status >= 500)
}
