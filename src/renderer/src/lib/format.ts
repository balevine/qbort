/** Compact integer formatting, e.g. 1400400 → "1,400,400". */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** USD cost: "$0.00" style, with more precision for tiny amounts. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Cost label that renders local providers as free and optionally marks a value as an estimate. */
export function formatCost(costUsd: number, opts: { isLocal: boolean; approx?: boolean }): string {
  if (opts.isLocal) return '$0 · local'
  return `${opts.approx ? '~' : ''}${formatUsd(costUsd)}`
}

/** Best-effort human message from an unknown thrown value, with an optional fallback. */
export function errorMessage(e: unknown, fallback?: string): string {
  if (e instanceof Error) return e.message
  return fallback ?? String(e)
}

/** Milliseconds → "1m 13s" / "8.2s". */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s - m * 60)}s`
}
