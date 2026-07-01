/** A pulsing square "live" indicator (neo-brutalist: hard edges, no rounding). */
export function PulseDot() {
  return (
    <span className="relative flex h-3 w-3" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping bg-ink opacity-60" />
      <span className="relative inline-flex h-3 w-3 bg-ink" />
    </span>
  )
}
