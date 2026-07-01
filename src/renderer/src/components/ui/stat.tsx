/** A small bordered label/value cell used in the summary and progress grids. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-widest text-ink/50">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  )
}
