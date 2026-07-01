/**
 * Shared types used across the main, preload, and renderer processes.
 *
 * This file is the single source of truth for the IPC contract and the persisted data
 * model. Pure defaults/helpers live in `settings.ts` and `staff.ts`.
 */

/**
 * Supported LLM providers. Ollama is local; Anthropic is hosted (needs an API key).
 * (OpenAI and Gemini are intentionally out of scope for now — see the README.)
 */
export type ProviderId = 'ollama' | 'anthropic'

export const ALL_PROVIDERS: ProviderId[] = ['ollama', 'anthropic']
export const HOSTED_PROVIDERS: ProviderId[] = ['anthropic']
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: 'Ollama (local)',
  anthropic: 'Anthropic'
}

/**
 * Human-readable name of the fixed model each hosted provider uses. Hosted providers don't let
 * the user choose a model (§5) — this is display-only. The authoritative model id + pricing live
 * in `main/generation/providers/models.ts`; keep this label in sync with it.
 */
export const HOSTED_MODEL_LABELS: Partial<Record<ProviderId, string>> = {
  anthropic: 'Claude Sonnet 5'
}

export function isHostedProvider(id: ProviderId): boolean {
  return HOSTED_PROVIDERS.includes(id)
}

/** A support staff member. Email is derived: `${alias}@company.biz`. */
export interface StaffMember {
  name: string
  alias: string
}

/** Numeric/boolean generation settings (the sliders + toggle in the UI). */
export interface GenerationSettings {
  /** Total tickets to generate. */
  numTickets: number
  /** Whether to include any staff responses at all. */
  includeStaffResponses: boolean
  /** Mean number of staff responses per ticket. */
  avgStaffResponses: number
  /** Size of the staff roster. */
  numStaffMembers: number
  /** Oldest a synthesized ticket can be, in days: message timestamps fall within this window. */
  maxTicketAgeDays: number
}

export interface OllamaConfig {
  host: string
  model: string
}

/** The full persisted settings document (no secrets — those live in the keychain). */
export interface Settings {
  providerId: ProviderId
  ollama: OllamaConfig
  generation: GenerationSettings
  staffRoster: StaffMember[]
  prompt: string
  /** Folder where ticket JSON is saved / auto-loaded. `null` → app default (userData). */
  defaultDir: string | null
  /** Path of the most recently written/loaded ticket file. */
  lastOutputPath: string | null
}

/** Allowed ticket statuses. The prompt can influence the mix; output is validated to this set. */
export const TICKET_STATUSES = ['new', 'open', 'pending', 'on-hold', 'solved', 'closed'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export const DEFAULT_TICKET_STATUS: TicketStatus = 'open'

/** Author of a message. Staff authors are on the company.biz domain. */
export interface TicketAuthor {
  name: string
  email: string
}

/**
 * One message in a ticket conversation. The first message is the customer's opening message;
 * the rest are follow-ups (staff replies or customer follow-ups). `isStaff` and `createdAt`
 * are assigned by the app, not trusted from the LLM.
 */
export interface TicketMessage {
  from: TicketAuthor
  body: string
  /** True when the author is a staff member (company.biz domain). */
  isStaff: boolean
  /** ISO 8601 timestamp; messages within a ticket are strictly increasing. */
  createdAt: string
}

/**
 * The output ticket. `id` (sequential integer) and every message's `isStaff`/`createdAt` are
 * assigned by the app. All messages — including the customer's opening one — live in `messages`.
 */
export interface Ticket {
  id: number
  subject: string
  status: TicketStatus
  messages: TicketMessage[]
}

/** Pricing snapshot recorded with a run. */
export interface TicketPricing {
  inputPerM: number
  outputPerM: number
  currency: 'USD'
}

/** Token usage + cost recorded in a generated file's meta. */
export interface TicketUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  batches: number
  estimatedCostUsd: number
  actualCostUsd: number
  pricing: TicketPricing
  durationMs: number
}

/** Metadata header of a generated tickets file. */
export interface TicketsMeta {
  generatedAt: string
  appVersion: string
  provider: ProviderId
  model: string
  requestedCount: number
  generatedCount: number
  settings: { generation: GenerationSettings }
  usage: TicketUsage
}

/** The on-disk tickets file. */
export interface TicketFile {
  meta: TicketsMeta
  tickets: Ticket[]
}

/** Pre-run cost/token estimate shown in the confirmation gate. */
export interface CostEstimate {
  provider: ProviderId
  model: string
  batches: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  estimatedCostUsd: number
  currency: 'USD'
  isLocal: boolean
}

/** Live progress streamed from main during a run. */
export interface GenerationProgress {
  ticketsDone: number
  ticketsTotal: number
  batchesDone: number
  batchesTotal: number
  retries: number
  dropped: number
  errors: string[]
  /** Output tokens currently streaming across in-flight batches (live feedback). */
  streamingTokens: number
  /** Estimated overall completion (0–1), including in-flight streaming. */
  fraction: number
}

/** Final result of a generation run. */
export interface GenerationRunResult {
  filePath: string
  cancelled: boolean
  file: TicketFile
}

/** Result of a provider "test connection" probe. */
export interface ConnectionTestResult {
  ok: boolean
  message: string
}

/** Whether an API key is stored for each hosted provider. */
export type SecretStatus = Record<string, boolean>

/**
 * The surface exposed on `window.api` by the preload script. Every method maps to a
 * single, explicitly-allow-listed IPC channel handled in the main process.
 */
export interface IpcApi {
  settings: {
    get: () => Promise<Settings>
    set: (partial: Partial<Settings>) => Promise<Settings>
  }
  secrets: {
    setKey: (provider: ProviderId, key: string) => Promise<boolean>
    hasKey: (provider: ProviderId) => Promise<boolean>
    clearKey: (provider: ProviderId) => Promise<boolean>
    status: () => Promise<SecretStatus>
  }
  provider: {
    testConnection: (provider: ProviderId) => Promise<ConnectionTestResult>
  }
  ollama: {
    listModels: (host: string) => Promise<string[]>
  }
  generation: {
    estimate: () => Promise<CostEstimate>
    start: () => Promise<GenerationRunResult>
    cancel: () => Promise<void>
    /** Subscribe to live progress; returns an unsubscribe function. */
    onProgress: (cb: (progress: GenerationProgress) => void) => () => void
  }
  tickets: {
    /** Load the default/last tickets file on launch (null if none exists). */
    loadDefault: () => Promise<LoadedTickets | null>
    /** Open a file picker and load the chosen tickets JSON. */
    open: () => Promise<LoadedTickets | null>
    /**
     * Export the currently-loaded file (tracked in main) to a chosen path; returns the
     * destination or null. Takes no source path — main never exports a renderer-supplied one.
     */
    export: () => Promise<string | null>
  }
  dialog: {
    chooseDirectory: () => Promise<string | null>
  }
}

/** A tickets file loaded from disk, with its path. */
export interface LoadedTickets {
  file: TicketFile
  filePath: string
}

/** Channel name constants — keeps preload and main in sync without magic strings. */
export const IpcChannels = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  secretsSetKey: 'secrets:setKey',
  secretsHasKey: 'secrets:hasKey',
  secretsClearKey: 'secrets:clearKey',
  secretsStatus: 'secrets:status',
  providerTestConnection: 'provider:testConnection',
  ollamaListModels: 'ollama:listModels',
  generationEstimate: 'generation:estimate',
  generationStart: 'generation:start',
  generationCancel: 'generation:cancel',
  generationProgress: 'generation:progress',
  ticketsLoadDefault: 'tickets:loadDefault',
  ticketsOpen: 'tickets:open',
  ticketsExport: 'tickets:export',
  dialogChooseDirectory: 'dialog:chooseDirectory'
} as const
