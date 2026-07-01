import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TicketStore, resolveOutputDir } from './storage'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { TicketFile } from '@shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tg-store-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const sampleFile: TicketFile = {
  meta: {
    generatedAt: '2026-06-30T00:00:00.000Z',
    appVersion: '0.1.0',
    provider: 'ollama',
    model: 'test',
    requestedCount: 1,
    generatedCount: 1,
    settings: { generation: DEFAULT_SETTINGS.generation },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      batches: 1,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      pricing: { inputPerM: 0, outputPerM: 0, currency: 'USD' },
      durationMs: 1
    }
  },
  tickets: [
    {
      id: 1,
      subject: 's',
      status: 'open',
      messages: [
        { from: { name: 'n', email: 'e@x.com' }, body: 'b', isStaff: false, createdAt: '2026-06-30T00:00:00.000Z' }
      ]
    }
  ]
}

describe('resolveOutputDir', () => {
  it('uses the default dir when set, else the fallback', () => {
    expect(resolveOutputDir({ ...DEFAULT_SETTINGS, defaultDir: '/custom' }, '/fallback')).toBe('/custom')
    expect(resolveOutputDir({ ...DEFAULT_SETTINGS, defaultDir: null }, '/fallback')).toBe('/fallback')
    expect(resolveOutputDir({ ...DEFAULT_SETTINGS, defaultDir: '  ' }, '/fallback')).toBe('/fallback')
  })
})

describe('TicketStore', () => {
  it('writes a file and reads it back identically', async () => {
    const store = new TicketStore(dir)
    const path = await store.write(sampleFile)
    expect(path).toBe(join(dir, 'tickets.json'))

    const read = await TicketStore.readFile(path)
    expect(read).toEqual(sampleFile)
  })

  it('returns null for a missing or invalid file', async () => {
    expect(await TicketStore.readFile(join(dir, 'nope.json'))).toBeNull()
    await fs.writeFile(join(dir, 'bad.json'), '{ not json', 'utf-8')
    expect(await TicketStore.readFile(join(dir, 'bad.json'))).toBeNull()
  })

  it('returns null for an old pre-messages[] file so the viewer falls back to empty state', async () => {
    const legacy = {
      meta: sampleFile.meta,
      tickets: [{ id: 'T-1', subject: 's', body: 'b', status: 'new', from: { name: 'n', email: 'e@x.com' }, responses: [] }]
    }
    await fs.writeFile(join(dir, 'legacy.json'), JSON.stringify(legacy), 'utf-8')
    expect(await TicketStore.readFile(join(dir, 'legacy.json'))).toBeNull()
  })

  it('overwrites atomically on repeated writes', async () => {
    const store = new TicketStore(dir)
    await store.write(sampleFile)
    const updated = { ...sampleFile, tickets: [...sampleFile.tickets, { ...sampleFile.tickets[0], id: 2 }] }
    await store.write(updated)
    const read = await TicketStore.readFile(store.filePath)
    expect(read?.tickets).toHaveLength(2)
  })

  it('does not corrupt the file under many concurrent writes (unique temp files)', async () => {
    const store = new TicketStore(dir)
    // Fire 25 overlapping writes with different ticket counts. A shared temp filename would
    // race writeFile/rename and either throw ENOENT or leave truncated JSON.
    const writes = Array.from({ length: 25 }, (_, n) =>
      store.write({
        ...sampleFile,
        tickets: Array.from({ length: n + 1 }, (_, i) => ({
          ...sampleFile.tickets[0],
          id: i + 1
        }))
      })
    )
    await expect(Promise.all(writes)).resolves.toBeDefined()
    // The final file must be valid, parseable JSON (never a half-written temp).
    const read = await TicketStore.readFile(store.filePath)
    expect(read).not.toBeNull()
    expect(Array.isArray(read?.tickets)).toBe(true)
    // No leftover temp files.
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
