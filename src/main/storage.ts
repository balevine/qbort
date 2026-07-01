import { join } from 'path'
import type { Settings, TicketFile } from '@shared/types'
import { parseTicketFile } from '@shared/ticketFile'
import { atomicWriteJson, readJson } from './fsUtil'

export const DEFAULT_TICKETS_FILENAME = 'tickets.json'

/** Effective output directory: the user's default dir if set, else the app fallback. */
export function resolveOutputDir(settings: Settings, fallbackDir: string): string {
  const dir = settings.defaultDir?.trim()
  return dir ? dir : fallbackDir
}

/** Reads/writes the tickets JSON file. Writes atomically (temp + rename). */
export class TicketStore {
  readonly filePath: string

  constructor(dir: string, fileName: string = DEFAULT_TICKETS_FILENAME) {
    this.filePath = join(dir, fileName)
  }

  async write(file: TicketFile): Promise<string> {
    await atomicWriteJson(this.filePath, file)
    return this.filePath
  }

  /**
   * Read + parse a tickets file by absolute path. Returns null if it's missing, unparseable, or
   * doesn't match the current schema (e.g. an old pre-`messages[]` file) — callers treat null as
   * "no file", so a stale/incompatible file falls back to the empty state instead of crashing.
   */
  static async readFile(path: string): Promise<TicketFile | null> {
    return parseTicketFile(await readJson(path))
  }
}
