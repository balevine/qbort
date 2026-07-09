/** How many tickets to request per LLM call. Used by the prompt preview and the orchestrator. */
export const DEFAULT_BATCH_SIZE = 20

/**
 * Post-validation top-up rounds. Validation drops malformed tickets, so a pass can yield fewer
 * than requested. After the initial pass the orchestrator re-counts and generates just the
 * shortfall, re-validating only the new tickets, for up to this many additional rounds — or until
 * the requested count is reached. A small cap bounds cost when a model keeps producing junk.
 */
export const MAX_TOPUP_ROUNDS = 3

/** Upper bound on staff responses targeted for any single ticket (keeps prompts sane). */
export const MAX_RESPONSES_PER_TICKET = 30

/** Rough output-token heuristics, shared by the cost estimate and the live progress fraction. */
export const OUTPUT_TOKENS_PER_TICKET = 180
export const OUTPUT_TOKENS_PER_RESPONSE = 90

/** Estimated output tokens for one ticket given the staff-response settings. */
export function estimatedTokensPerTicket(includeStaffResponses: boolean, avgStaffResponses: number): number {
  return OUTPUT_TOKENS_PER_TICKET + (includeStaffResponses ? avgStaffResponses * OUTPUT_TOKENS_PER_RESPONSE : 0)
}

/**
 * Soft budget for output tokens per batch. We size batches so the *expected* output stays
 * under this, keeping each call within provider limits and avoiding mid-JSON truncation
 * (which would drop the whole batch). Chosen conservatively so staff-heavy runs still fit.
 */
export const OUTPUT_TOKEN_BUDGET_PER_BATCH = 12_000

/** Hard ceiling on the `max_tokens` we ask any provider for. */
export const MAX_OUTPUT_TOKENS_CEILING = 32_000

/** Safety margin over the *estimated* output so natural variation doesn't truncate a batch. */
const OUTPUT_TOKEN_MARGIN = 1.6

/**
 * Shrink the configured batch size so the expected output for one batch fits the budget.
 * For the common no-staff case the per-ticket cost is small and the batch is unchanged;
 * heavy staff-response settings adaptively produce smaller batches instead of truncating.
 */
export function effectiveBatchSize(
  configured: number,
  includeStaffResponses: boolean,
  avgStaffResponses: number,
  budget = OUTPUT_TOKEN_BUDGET_PER_BATCH
): number {
  const perTicket = estimatedTokensPerTicket(includeStaffResponses, avgStaffResponses)
  const fit = Math.floor(budget / Math.max(1, perTicket))
  return Math.max(1, Math.min(Math.max(1, Math.floor(configured)), fit))
}

/**
 * Expected output tokens for a batch. When the actual per-ticket response counts have been
 * sampled they're used directly (the sum captures the Poisson tail a flat average misses);
 * otherwise it falls back to `count × avg`. This is what we size `max_tokens` from.
 */
export function expectedBatchOutputTokens(
  count: number,
  includeStaffResponses: boolean,
  avgStaffResponses: number,
  responseCounts?: number[]
): number {
  const base = Math.max(1, count) * OUTPUT_TOKENS_PER_TICKET
  if (!includeStaffResponses) return base
  const responses = responseCounts
    ? responseCounts.reduce((sum, n) => sum + n, 0)
    : Math.max(1, count) * avgStaffResponses
  return base + responses * OUTPUT_TOKENS_PER_RESPONSE
}

/** `max_tokens` to request for a given expected output size (+ margin), clamped. */
export function maxOutputTokensForExpected(expectedOutputTokens: number): number {
  const sized = Math.ceil(Math.max(1, expectedOutputTokens) * OUTPUT_TOKEN_MARGIN) + 512
  return Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.max(1024, sized))
}

/** `max_tokens` to request for a batch, sized to the expected output (+ margin), clamped. */
export function maxOutputTokensForBatch(count: number, perTicketTokens: number): number {
  return maxOutputTokensForExpected(Math.max(1, count) * Math.max(1, perTicketTokens))
}
