// Seeded RNG so a run is deterministic given its seed. The desktop app injects `rng`/`now`
// into the orchestrator; here we do the same, but derive independent sub-streams per purpose
// (opening times, per-batch response counts, per-round assembly) so the separate engine
// invocations (plan / topup / assemble) don't have to thread a single mutable stream through
// files. Same seed + same inputs => same output.

/** mulberry32: tiny, fast, well-distributed 32-bit PRNG returning [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a hash of the joined parts → a 32-bit seed. Lets us key a sub-stream by labels. */
export function hashSeed(...parts) {
  const s = parts.join('|')
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** An independent RNG sub-stream keyed by (seed, ...labels). */
export function rngFor(seed, ...parts) {
  return mulberry32(hashSeed(String(seed), ...parts.map(String)))
}
