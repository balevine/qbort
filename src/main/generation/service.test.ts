import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateBatchArgs, GenerateBatchResult, LLMProvider } from './providers'

// A swappable fake provider, hoisted so the module mock below can reference it. createProvider is
// replaced; the rest of the providers barrel (pricing/model lookup) stays real.
const h = vi.hoisted(() => {
  const rawTickets = (n: number) => ({
    tickets: Array.from({ length: n }, (_, i) => ({
      subject: `S${i}`,
      body: `B${i}`,
      status: 'open',
      from: { name: `C${i}`, email: `c${i}@example.com` }
    }))
  })
  let generate: (args: { count: number }) => Promise<GenerateBatchResult> = async ({ count }) => ({
    raw: rawTickets(count),
    usage: { inputTokens: 2, outputTokens: 3 }
  })
  const provider: LLMProvider = {
    id: 'ollama',
    model: 'test-model',
    // The orchestrator opens every run with one scenario call, identifiable by having no
    // `staticPrefix`. Answer it here so the per-test `generate` overrides below only ever see
    // ticket batches, and zero its usage so the token/cost assertions stay batch-only.
    generateBatch: (args: GenerateBatchArgs) =>
      args.staticPrefix === undefined
        ? Promise.resolve({
            raw: { scenarios: Array.from({ length: args.count }, (_, i) => `Scenario ${i + 1}`) },
            usage: { inputTokens: 0, outputTokens: 0 }
          })
        : generate(args)
  }
  return {
    rawTickets,
    provider,
    setGenerate: (fn: (args: { count: number }) => Promise<GenerateBatchResult>) => {
      generate = fn
    }
  }
})

// secrets.ts imports electron for its default crypto; stub it so the store loads outside Electron.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

vi.mock('./providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers')>()
  return { ...actual, createProvider: async () => h.provider }
})

import { GenerationService } from './service'
import { SettingsStore } from '../settings'
import { SecretStore, type SecretCrypto } from '../secrets'
import { DEFAULT_SETTINGS } from '@shared/settings'

const FIXED_NOW = Date.parse('2026-06-30T12:00:00.000Z')
const fakeCrypto: SecretCrypto = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s),
  decrypt: (b) => b.toString()
}

let dir: string
let settings: SettingsStore
let service: GenerationService

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tg-service-'))
  settings = new SettingsStore(dir)
  await settings.set({ generation: { ...DEFAULT_SETTINGS.generation, numTickets: 6 } })
  const secrets = new SecretStore(dir, fakeCrypto)
  service = new GenerationService(settings, secrets, dir, '9.9.9', () => FIXED_NOW)
  h.setGenerate(async ({ count }) => ({ raw: h.rawTickets(count), usage: { inputTokens: 2, outputTokens: 3 } }))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('GenerationService.start', () => {
  it('runs a generation, writes the file, and records meta/usage with the injected clock', async () => {
    const result = await service.start(() => {})

    expect(result.cancelled).toBe(false)
    expect(result.file.tickets).toHaveLength(6)
    expect(result.file.tickets.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6])

    const { meta } = result.file
    expect(meta.provider).toBe('ollama')
    expect(meta.model).toBe('test-model')
    expect(meta.appVersion).toBe('9.9.9')
    expect(meta.requestedCount).toBe(6)
    expect(meta.generatedCount).toBe(6)
    expect(meta.generatedAt).toBe(new Date(FIXED_NOW).toISOString())
    // In-app runs always record usage (only skill-generated files omit it).
    const usage = meta.usage!
    expect(usage.durationMs).toBe(0) // clock is constant under test
    expect(usage.actualCostUsd).toBe(0) // ollama is local/free
    expect(usage.batches).toBeGreaterThanOrEqual(1)

    // The file is on disk and the last-output path is persisted.
    expect(result.filePath).toBe(join(dir, 'tickets.json'))
    const onDisk = JSON.parse(await fs.readFile(result.filePath, 'utf-8'))
    expect(onDisk.tickets).toHaveLength(6)
    expect((await settings.get()).lastOutputPath).toBe(result.filePath)
  })

  it('rejects a second run while one is already in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    h.setGenerate(async ({ count }) => {
      await gate
      return { raw: h.rawTickets(count), usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const first = service.start(() => {})
    await expect(service.start(() => {})).rejects.toThrow(/already running/i)

    release()
    await first
    // The slot is freed once the first run finishes, so a fresh run is allowed.
    await expect(service.start(() => {})).resolves.toBeDefined()
  })

  it('coalesces overlapping incremental writes and still leaves a valid final file', async () => {
    // Concurrency plus many batches means several onBatchComplete writes overlap; the coalescing
    // writer must serialize them without corrupting the file or leaving temp files behind.
    await settings.set({ generation: { ...DEFAULT_SETTINGS.generation, numTickets: 40 } })
    const result = await service.start(() => {})
    expect(result.file.tickets).toHaveLength(40)
    const onDisk = JSON.parse(await fs.readFile(result.filePath, 'utf-8'))
    expect(onDisk.tickets).toHaveLength(40)
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
