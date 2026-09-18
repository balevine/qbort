// Where a run puts things. Two directories, both hardcoded relative to the working directory the
// engine is invoked from, because the engine takes no path from the caller and so can only ever
// touch its own.
//
// The split exists so the scratch can be wiped unconditionally at the start of every run. Working
// files sit at fixed names (`round-0.json`, `batch-0-0.json`) that *subagents*, not the engine, are
// expected to fill. The engine has no way to tell a leftover file from a previous run apart from one
// a subagent just wrote, so without the wipe, stale tickets get folded into the new output silently.
// The product has to live outside the wipe for the wipe to be safe.

/** Run state, compiled prompts, raw subagent output. Wiped completely at the start of every run. */
export const SCRATCH_DIR = '.qbort-run'

/** Finished ticket files. Never wiped, never overwritten: one new file per run. */
export const OUTPUT_DIR = 'qbort-output'

/** The names `outputFileName` produces, for readers that have to pick one out of a directory. */
export const OUTPUT_FILE_RE = /^tickets-\d{8}-\d{6}\.json$/

/** @param {number} n @returns {string} */
function pad(n) {
  return String(n).padStart(2, '0')
}

/**
 * The file name a run writes: `tickets-YYYYMMDD-HHMMSS.json`.
 *
 * Local time, because the person scanning the directory listing is in it. Stamped once, at `plan`,
 * and carried in the run context: `assemble` runs again after every top-up round, so a name chosen
 * at write time would leave a run that needed two top-ups with three files, all looking finished and
 * only the last complete.
 *
 * @param {Date} [date] defaults to now; injectable so tests are deterministic
 * @returns {string}
 */
export function outputFileName(date = new Date()) {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `tickets-${ymd}-${hms}.json`
}

/**
 * The most recent output file name in `names`, ignoring anything that isn't one. The timestamp sorts
 * lexically in chronological order, so this is a string comparison and not date parsing.
 * @param {string[]} names
 * @returns {string | null} null when `names` holds no output file
 */
export function newestOutputName(names) {
  let newest = null
  for (const name of names) {
    if (!OUTPUT_FILE_RE.test(name)) continue
    if (newest === null || name > newest) newest = name
  }
  return newest
}
