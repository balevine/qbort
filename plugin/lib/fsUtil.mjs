// Atomic writes (create dir → write unique temp → rename) so a crash mid-write never leaves a
// half-written file and concurrent writers can't clobber each other's temp file. Every file the
// engine produces goes through here. A torn `tickets.json` is the run's whole output, and a torn
// prompt file is a batch of garbage tickets.

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/** Monotonic counter so overlapping writes never share a temp filename. */
let writeSeq = 0

/**
 * Atomically write `contents` to `filePath`.
 * @param {string} filePath
 * @param {string} contents
 * @returns {Promise<void>}
 */
export async function atomicWriteText(filePath, contents) {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${writeSeq++}.tmp`
  await fs.writeFile(tmp, contents, 'utf-8')
  await fs.rename(tmp, filePath)
}

/**
 * Atomically write a value as pretty (2-space) JSON.
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
export async function atomicWriteJson(filePath, data) {
  await atomicWriteText(filePath, JSON.stringify(data, null, 2))
}

/**
 * Read a file as UTF-8 text. Returns null if it's missing or unreadable.
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
export async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Read + JSON-parse a file. Returns null if it's missing or not valid JSON.
 * @template [T=unknown]
 * @param {string} filePath
 * @returns {Promise<T | null>}
 */
export async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}
