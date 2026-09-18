// Clearing the run scratch. This is what makes a run's working files unambiguously *this* run's:
// see the note in paths.mjs for why a stale batch file is worse than a missing one.

import { promises as fs } from 'node:fs'

/**
 * Remove `dir` and everything in it, then recreate it empty.
 *
 * A recursive remove is safe here only because callers pass `SCRATCH_DIR` resolved against the
 * working directory and nothing else. There is no caller-supplied path for this to follow. Keep it
 * that way.
 *
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function clearScratch(dir) {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
}
