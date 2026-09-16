import { useEffect, useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Pagination } from '@/components/Pagination'
import { TicketModal } from '@/components/TicketModal'
import { Stat } from '@/components/ui/stat'
import { useTickets } from '@/state/TicketsContext'
import { useToast } from '@/state/ToastContext'
import { PAGE_SIZE, filterTickets, pageCount, pageOf, type StatusFilter } from '@/lib/tickets'
import { errorMessage, formatCost, formatDuration, formatInt, formatTicketId, formatTimestamp } from '@/lib/format'
import { ticketFileProviderLabel, TICKET_STATUSES } from '@shared/types'

export function TicketsView() {
  const { file, filePath } = useTickets()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const tickets = file?.tickets ?? []
  const filtered = useMemo(() => filterTickets(tickets, { query, status }), [tickets, query, status])
  const pages = pageCount(filtered.length)
  const pageItems = pageOf(filtered, page)

  // Counts by status over the whole file (spec §7 summary). Only statuses present are shown.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tickets) counts.set(t.status, (counts.get(t.status) ?? 0) + 1)
    return TICKET_STATUSES.filter((s) => counts.has(s)).map((s) => [s, counts.get(s)!] as const)
  }, [tickets])

  // Reset page + close the modal whenever the filter changes (indices would be stale).
  useEffect(() => {
    setPage(0)
    setSelectedIndex(null)
  }, [query, status])
  useEffect(() => {
    if (page > pages - 1) setPage(0)
  }, [page, pages])

  // Step to an adjacent ticket in the filtered list, keeping the page in sync.
  const goTo = (next: number) => {
    if (next < 0 || next >= filtered.length) return
    setSelectedIndex(next)
    setPage(Math.floor(next / PAGE_SIZE))
  }

  if (!file) return null
  const { meta } = file

  const exportFile = async () => {
    if (!filePath) return
    try {
      const dest = await window.api.tickets.export()
      if (dest) toast(`Exported to ${dest}`)
    } catch (e) {
      toast(errorMessage(e, 'Export failed'), 'error')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* Summary */}
      <div className="brutal-box p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-mono text-base font-bold uppercase tracking-widest">
            {formatInt(tickets.length)} tickets
          </h1>
          <span className="font-mono text-xs uppercase tracking-widest text-ink/50">
            {ticketFileProviderLabel(meta.provider)} · {meta.model}
          </span>
        </div>
        {/* Token/cost stats only exist for accounted runs; skill-generated files show "—". */}
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
          <Stat label="Tokens" value={meta.usage ? formatInt(meta.usage.totalTokens) : '—'} />
          <Stat
            label="Cost"
            value={
              meta.usage ? formatCost(meta.usage.actualCostUsd, { isLocal: meta.provider === 'ollama' }) : '—'
            }
          />
          <Stat label="Batches" value={meta.usage ? formatInt(meta.usage.batches) : '—'} />
          <Stat label="Duration" value={meta.usage ? formatDuration(meta.usage.durationMs) : '—'} />
        </div>
        {statusCounts.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-widest">
            {statusCounts.map(([s, n]) => (
              <span key={s} className="border-2 border-ink px-1.5 py-0.5">
                {s} · <span className="font-bold">{formatInt(n)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subject, body, customer…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportFile} disabled={!filePath}>
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Result count + pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-ink/50">
          {formatInt(filtered.length)}
          {filtered.length !== tickets.length ? ` of ${formatInt(tickets.length)}` : ''} shown
        </span>
        <Pagination page={page} pageCount={pages} onPage={setPage} />
      </div>

      {/* Table */}
      <div className="brutal-box overflow-hidden">
        <div className="grid grid-cols-[4.5rem_1fr_6rem_10.5rem_10rem] items-center gap-3 border-b-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-paper">
          <span>ID</span>
          <span>Subject</span>
          <span>Status</span>
          <span>From</span>
          <span>Created</span>
        </div>
        {pageItems.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink/50">
            {tickets.length === 0 ? 'This file has no tickets.' : 'No tickets match your filters.'}
          </p>
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {pageItems.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedIndex(page * PAGE_SIZE + i)}
                  className="grid w-full grid-cols-[4.5rem_1fr_6rem_10.5rem_10rem] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.05]"
                >
                  <span className="font-mono text-[11px] text-ink/50">{formatTicketId(t.id)}</span>
                  <span className="truncate text-sm">{t.subject}</span>
                  <span className="w-fit border-2 border-ink px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest">
                    {t.status}
                  </span>
                  <span className="truncate font-mono text-[11px] text-ink/60" title={t.messages[0]?.from.email}>
                    {t.messages[0]?.from.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-ink/50">
                    {t.messages[0] ? formatTimestamp(t.messages[0].createdAt) : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TicketModal
        ticket={selectedIndex != null ? (filtered[selectedIndex] ?? null) : null}
        index={selectedIndex ?? 0}
        total={filtered.length}
        onClose={() => setSelectedIndex(null)}
        onPrev={() => selectedIndex != null && goTo(selectedIndex - 1)}
        onNext={() => selectedIndex != null && goTo(selectedIndex + 1)}
      />
    </div>
  )
}
