import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'
import { DEFAULT_SETTINGS, LIMITS } from '@shared/settings'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tg-settings-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('returns defaults when no file exists', async () => {
    const store = new SettingsStore(dir)
    expect(await store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates and reloads them from disk', async () => {
    const store = new SettingsStore(dir)
    await store.set({ providerId: 'anthropic' })
    await store.set({ generation: { ...DEFAULT_SETTINGS.generation, numTickets: 321 } })

    // A fresh store (no cache) must read the persisted file.
    const reloaded = new SettingsStore(dir)
    const s = await reloaded.get()
    expect(s.providerId).toBe('anthropic')
    expect(s.generation.numTickets).toBe(321)

    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.providerId).toBe('anthropic')
  })

  it('clamps out-of-range values on write', async () => {
    const store = new SettingsStore(dir)
    const s = await store.set({
      generation: { ...DEFAULT_SETTINGS.generation, numTickets: 1_000_000 }
    })
    expect(s.generation.numTickets).toBe(LIMITS.numTickets.max)
  })

  it('recovers from a corrupt file by falling back to defaults', async () => {
    await fs.writeFile(join(dir, 'settings.json'), '{ not valid json', 'utf-8')
    const store = new SettingsStore(dir)
    expect(await store.get()).toEqual(DEFAULT_SETTINGS)
  })
})
