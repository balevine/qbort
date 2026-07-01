import { promises as fs } from 'fs'
import { dirname } from 'path'

/** Monotonic counter so overlapping writes never share a temp filename. */
let writeSeq = 0

/**
 * Atomically write a value as pretty JSON to `filePath` (create dir → write unique temp →
 * rename), so a crash mid-write never leaves a half-written file and concurrent writers can't
 * clobber each other's temp file.
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${writeSeq++}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

/** Read + JSON-parse a file. Returns null if it's missing or not valid JSON. */
export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}
