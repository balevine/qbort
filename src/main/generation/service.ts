import type {
  CostEstimate,
  GenerationProgress,
  GenerationRunResult,
  TicketFile,
  TicketsMeta
} from '@shared/types'
import type { Settings } from '@shared/types'
import { DEFAULT_BATCH_SIZE } from '@shared/generation'
import type { SettingsStore } from '../settings'
import type { SecretStore } from '../secrets'
import { TicketStore, resolveOutputDir } from '../storage'
import { runGeneration, type BatchSnapshot } from './orchestrator'
import { estimateRun } from './estimate'
import { costForUsage, createProvider, getPricing } from './providers'

/**
 * Batch size + concurrency tuned per provider. Local Ollama runs on a single GPU, so small
 * sequential batches surface results sooner; hosted APIs handle larger, parallel batches well.
 */
function runParams(settings: Settings): { batchSize: number; concurrency: number } {
  if (settings.providerId === 'ollama') return { batchSize: 5, concurrency: 1 }
  return { batchSize: DEFAULT_BATCH_SIZE, concurrency: 4 }
}

/**
 * Coordinates a generation run: builds the provider, runs the orchestrator, persists
 * incrementally, assembles the file meta (usage + cost), and enforces one-run-at-a-time.
 */
export class GenerationService {
  private active: AbortController | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly userData: string,
    private readonly appVersion: string,
    /** Injectable clock (ms) so runs are deterministic under test. */
    private readonly now: () => number = () => Date.now()
  ) {}

  async estimate(): Promise<CostEstimate> {
    const settings = await this.settings.get()
    return estimateRun(settings, runParams(settings).batchSize)
  }

  cancel(): void {
    this.active?.abort()
  }

  async start(onProgress: (p: GenerationProgress) => void): Promise<GenerationRunResult> {
    // Claim the single-run slot synchronously, before any await, so two racing start() calls
    // can't both slip past the guard during the awaits below.
    if (this.active) throw new Error('A generation is already running.')
    const controller = new AbortController()
    this.active = controller

    try {
      return await this.run(controller, onProgress)
    } finally {
      this.active = null
    }
  }

  private async run(
    controller: AbortController,
    onProgress: (p: GenerationProgress) => void
  ): Promise<GenerationRunResult> {
    const settings = await this.settings.get()
    const provider = await createProvider(settings, (p) => this.secrets.getKey(p))
    const { batchSize, concurrency } = runParams(settings)
    const estimate = estimateRun(settings, batchSize)
    const startedAt = this.now()
    const store = new TicketStore(resolveOutputDir(settings, this.userData))

    const buildFile = (snapshot: Pick<BatchSnapshot, 'tickets' | 'usage'>): TicketFile => {
      const { inputTokens, outputTokens, batches } = snapshot.usage
      const meta: TicketsMeta = {
        generatedAt: new Date(this.now()).toISOString(),
        appVersion: this.appVersion,
        provider: provider.id,
        model: provider.model,
        requestedCount: settings.generation.numTickets,
        generatedCount: snapshot.tickets.length,
        settings: { generation: settings.generation },
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          batches,
          estimatedCostUsd: estimate.estimatedCostUsd,
          actualCostUsd: costForUsage(provider.id, { inputTokens, outputTokens }),
          pricing: getPricing(provider.id),
          durationMs: this.now() - startedAt
        }
      }
      return { meta, tickets: snapshot.tickets }
    }

    // Coalescing single-flight writer: with concurrent batches, overlapping incremental writes
    // must not run at once (they'd race the atomic temp/rename). Collapse to the latest snapshot
    // and write them one at a time; snapshots only grow, so latest-wins is safe.
    let pending: TicketFile | null = null
    let writing: Promise<void> | null = null
    const scheduleWrite = (file: TicketFile): Promise<void> => {
      pending = file
      if (writing) return writing
      writing = (async () => {
        try {
          while (pending) {
            const next = pending
            pending = null
            await store.write(next)
          }
        } finally {
          writing = null
        }
      })()
      return writing
    }

    const run = await runGeneration({
      provider,
      settings,
      signal: controller.signal,
      batchSize,
      concurrency,
      now: startedAt,
      onProgress,
      onBatchComplete: (snapshot) => scheduleWrite(buildFile(snapshot))
    })

    // Drain any final coalesced write before the authoritative write below.
    if (writing) await writing

    const file = buildFile({ tickets: run.tickets, usage: run.usage })
    const filePath = await store.write(file)
    await this.settings.set({ lastOutputPath: filePath })
    return { filePath, cancelled: run.cancelled, file }
  }
}
