import type { GenerationSettings, OllamaConfig, Settings } from './types'
import { DEFAULT_STAFF_ROSTER, normalizeRoster } from './staff'

/** Bounds for the numeric settings (shared by the UI sliders and validation). */
export const LIMITS = {
  numTickets: { min: 1, max: 5000, default: 100 },
  avgStaffResponses: { min: 0, max: 20, default: 0 },
  numStaffMembers: { min: 1, max: 100, default: 10 }
} as const

export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434'

/** Minimal starter prompt — the user grows their own distributions from here. */
export const DEFAULT_PROMPT = `You generate realistic but fake customer support tickets for a SaaS product.

Guidelines:
- Vary the subject and body so tickets feel authentic and distinct.
- Use a realistic customer name and email (not on the company.biz domain).
- Spread tickets across a few categories, e.g. billing, login/access, bugs, and how-to questions.
- Mix sentiment: some frustrated, some neutral, some appreciative.

[Add your own categories, product descriptions, and any other instructions below. You can also modify any of the pre-existing content in this prompt to generate different kinds of tickets.]`

export const DEFAULT_GENERATION: GenerationSettings = {
  numTickets: LIMITS.numTickets.default,
  includeStaffResponses: false,
  avgStaffResponses: LIMITS.avgStaffResponses.default,
  numStaffMembers: LIMITS.numStaffMembers.default
}

export const DEFAULT_SETTINGS: Settings = {
  providerId: 'ollama',
  ollama: { host: DEFAULT_OLLAMA_HOST, model: '' },
  generation: { ...DEFAULT_GENERATION },
  staffRoster: DEFAULT_STAFF_ROSTER.map((m) => ({ ...m })),
  prompt: DEFAULT_PROMPT,
  defaultDir: null,
  lastOutputPath: null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Merge a raw (possibly partial or stale) settings object on top of the defaults,
 * coercing/clamping numeric fields. Unknown shapes fall back to defaults — this keeps
 * `settings.json` forward/backward compatible as the model evolves.
 */
export function withDefaults(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const gen = (r.generation && typeof r.generation === 'object' ? r.generation : {}) as Partial<GenerationSettings>
  const ollama = (r.ollama && typeof r.ollama === 'object' ? r.ollama : {}) as Partial<OllamaConfig>

  return {
    providerId:
      r.providerId && ['ollama', 'anthropic', 'openai', 'gemini'].includes(r.providerId)
        ? r.providerId
        : DEFAULT_SETTINGS.providerId,
    ollama: {
      host: typeof ollama.host === 'string' && ollama.host ? ollama.host : DEFAULT_OLLAMA_HOST,
      model: typeof ollama.model === 'string' ? ollama.model : ''
    },
    generation: {
      numTickets: clampInt(gen.numTickets, LIMITS.numTickets.min, LIMITS.numTickets.max, LIMITS.numTickets.default),
      includeStaffResponses:
        typeof gen.includeStaffResponses === 'boolean'
          ? gen.includeStaffResponses
          : DEFAULT_GENERATION.includeStaffResponses,
      avgStaffResponses: clampInt(
        gen.avgStaffResponses,
        LIMITS.avgStaffResponses.min,
        LIMITS.avgStaffResponses.max,
        LIMITS.avgStaffResponses.default
      ),
      numStaffMembers: clampInt(
        gen.numStaffMembers,
        LIMITS.numStaffMembers.min,
        LIMITS.numStaffMembers.max,
        LIMITS.numStaffMembers.default
      )
    },
    staffRoster:
      Array.isArray(r.staffRoster) && r.staffRoster.length > 0
        ? normalizeRoster(
            r.staffRoster
              .filter((m): m is { name: string; alias: string } => !!m && typeof m === 'object')
              .map((m) => ({ name: String(m.name ?? ''), alias: String(m.alias ?? '') }))
          )
        : DEFAULT_SETTINGS.staffRoster.map((m) => ({ ...m })),
    prompt: typeof r.prompt === 'string' ? r.prompt : DEFAULT_PROMPT,
    defaultDir: typeof r.defaultDir === 'string' ? r.defaultDir : null,
    lastOutputPath: typeof r.lastOutputPath === 'string' ? r.lastOutputPath : null
  }
}

/** Shallow-merge a partial update over the current settings (nested objects replaced whole). */
export function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  return withDefaults({ ...current, ...partial })
}
