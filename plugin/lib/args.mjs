// Tiny `--flag value` / `--flag` argument parser, extracted from engine.mjs so the engine is only
// orchestration. A flag followed by another `--flag` (or by nothing) is a boolean true. Every other
// value is a string, and callers coerce with `Number(...)` where they want a number.
//
// Bare (non-flag) arguments collect in `_`, following the minimist convention. The engine does not
// read `_`: the subcommand is taken positionally as `argv[0]` before this ever runs, and every other
// input is a named flag. The bucket just keeps a stray positional from being mistaken for a value.

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean> & { _: string[] }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean> & { _: string[] }} */
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}
