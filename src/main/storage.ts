import { join } from 'path'
import type { Settings, TicketFile } from '@shared/types'
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

  /** Read + parse a tickets file by absolute path. Returns null if missing/invalid. */
  static async readFile(path: string): Promise<TicketFile | null> {
    const parsed = await readJson<TicketFile>(path)
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.tickets) ? parsed : null
  }
}
