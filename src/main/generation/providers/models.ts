import type { ProviderId } from '@shared/types'

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerM: number
  /** USD per 1M output tokens. */
  outputPerM: number
  currency: 'USD'
}

export interface ModelInfo {
  model: string
  pricing: ModelPricing
}

/**
 * Curated, COST-BALANCED model per hosted provider (mid-tier, not flagship) — synthetic
 * text generation doesn't need reasoning-heavy flagships, and these run across many batches.
 *
 * ⚠️ Model IDs and pricing must be VERIFIED against each provider's current catalog — they
 * drift over time. This map is the single place to update them.
 */
export const HOSTED_MODELS: Record<'anthropic' | 'openai' | 'gemini', ModelInfo> = {
  anthropic: {
    model: 'claude-sonnet-4-6',
    pricing: { inputPerM: 3.0, outputPerM: 15.0, currency: 'USD' }
  },
  openai: {
    model: 'gpt-4.1-mini',
    pricing: { inputPerM: 0.4, outputPerM: 1.6, currency: 'USD' }
  },
  gemini: {
    model: 'gemini-2.5-flash',
    pricing: { inputPerM: 0.3, outputPerM: 2.5, currency: 'USD' }
  }
}

/** Local models cost nothing. */
export const LOCAL_PRICING: ModelPricing = { inputPerM: 0, outputPerM: 0, currency: 'USD' }

/** The chosen model id for a hosted provider. */
export function getModelId(provider: 'anthropic' | 'openai' | 'gemini'): string {
  return HOSTED_MODELS[provider].model
}

/** Pricing for a provider. Ollama (local) is always free. */
export function getPricing(provider: ProviderId): ModelPricing {
  if (provider === 'ollama') return LOCAL_PRICING
  return HOSTED_MODELS[provider].pricing
}

/** USD cost for a given token usage under a provider's pricing. */
export function costForUsage(
  provider: ProviderId,
  usage: { inputTokens: number; outputTokens: number }
): number {
  const p = getPricing(provider)
  return (usage.inputTokens / 1_000_000) * p.inputPerM + (usage.outputTokens / 1_000_000) * p.outputPerM
}
