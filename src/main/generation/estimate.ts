import type { CostEstimate, Settings } from '@shared/types'
import { DEFAULT_BATCH_SIZE, effectiveBatchSize, estimatedTokensPerTicket } from '@shared/generation'
import { compilePrompt } from '@shared/promptCompiler'
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

  const inputTokensPerBatch = Math.ceil(samplePrompt.length / CHARS_PER_TOKEN) + SYSTEM_TOKENS
  const estimatedInputTokens = inputTokensPerBatch * batches

  const perTicketOutput = estimatedTokensPerTicket(gen.includeStaffResponses, gen.avgStaffResponses)
  const estimatedOutputTokens = Math.ceil(total * perTicketOutput)

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
