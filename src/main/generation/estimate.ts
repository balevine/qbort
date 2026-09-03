import type { CostEstimate, Settings } from '@shared/types'
import {
  DEFAULT_BATCH_SIZE,
  OUTPUT_TOKENS_PER_SCENARIO,
  effectiveBatchSize,
  estimatedTokensPerTicket
} from '@shared/generation'
import { compilePrompt, compileScenarioPrompt, scenarioTarget } from '@shared/promptCompiler'
import { ensureRoster } from '@shared/staff'
import { costForUsage } from './providers/models'
import { modelForSettings } from './providers'
import { SYSTEM_PROMPT } from './providers/common'

const CHARS_PER_TOKEN = 4
const SYSTEM_TOKENS = Math.ceil(SYSTEM_PROMPT.length / CHARS_PER_TOKEN)

/**
 * Rough pre-run estimate. Input ≈ compiled prompt size × number of batches (caching ignored
 * for an upper bound); output ≈ tickets × (per-ticket + per-response tokens). Local = $0.
 */
export function estimateRun(settings: Settings, batchSize = DEFAULT_BATCH_SIZE): CostEstimate {
  const gen = settings.generation
  const total = Math.max(1, gen.numTickets)
  // Match the orchestrator's adaptive batch sizing so the batch count/cost line up with the run.
  const effBatch = effectiveBatchSize(batchSize, gen.includeStaffResponses, gen.avgStaffResponses)
  const batches = Math.ceil(total / effBatch)
  const sampleBatchCount = Math.min(total, effBatch)

  const roster = ensureRoster(settings.staffRoster, gen.numStaffMembers)
  const samplePrompt = compilePrompt({
    editablePrompt: settings.prompt,
    batchCount: sampleBatchCount,
    staff: {
      include: gen.includeStaffResponses,
      avgResponses: gen.avgStaffResponses,
      roster
    }
  })

  // Each batch prompt also carries the scenarios dealt to its tickets (one line each), which the
  // sample above doesn't include.
  const inputTokensPerBatch =
    Math.ceil(samplePrompt.length / CHARS_PER_TOKEN) +
    SYSTEM_TOKENS +
    sampleBatchCount * OUTPUT_TOKENS_PER_SCENARIO

  // Every run opens with one scenario call (see the orchestrator): the user's prompt plus a short
  // instruction block in, one line per scenario out.
  const scenarioCount = scenarioTarget(total)
  const scenarioPrompt = compileScenarioPrompt(settings.prompt, scenarioCount)
  const scenarioInputTokens = Math.ceil(scenarioPrompt.length / CHARS_PER_TOKEN) + SYSTEM_TOKENS
  const scenarioOutputTokens = scenarioCount * OUTPUT_TOKENS_PER_SCENARIO

  const estimatedInputTokens = inputTokensPerBatch * batches + scenarioInputTokens

  const perTicketOutput = estimatedTokensPerTicket(gen.includeStaffResponses, gen.avgStaffResponses)
  const estimatedOutputTokens = Math.ceil(total * perTicketOutput) + scenarioOutputTokens

  const provider = settings.providerId
  const estimatedCostUsd = costForUsage(provider, {
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens
  })

  return {
    provider,
    model: modelForSettings(settings),
    batches,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
    estimatedCostUsd,
    currency: 'USD',
    isLocal: provider === 'ollama'
  }
}
