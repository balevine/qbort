import { join } from 'path'
import type { Settings } from '@shared/types'
import { mergeSettings, withDefaults } from '@shared/settings'
import { atomicWriteJson, readJson } from './fsUtil'

/**
 * Reads/writes the persisted `settings.json`. The directory is injected so the store is
 * testable against a temp dir without booting Electron.
 */
export class SettingsStore {
  private readonly file: string
  private cache: Settings | null = null

  constructor(dir: string) {
    this.file = join(dir, 'settings.json')
  }

  async get(): Promise<Settings> {
    if (this.cache) return this.cache
    // Missing or corrupt file → withDefaults(null) yields the defaults.
    this.cache = withDefaults(await readJson(this.file))
    return this.cache
  }

  async set(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.get()
    const next = mergeSettings(current, partial)
    await atomicWriteJson(this.file, next)
    this.cache = next
    return next
  }
}
