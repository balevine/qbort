import type { Ticket, TicketStatus } from '@shared/types'

export const PAGE_SIZE = 100

export type StatusFilter = TicketStatus | 'all'

/** Filter tickets by status and a free-text query over id/subject/body/from. */
export function filterTickets(
  tickets: Ticket[],
  opts: { query?: string; status?: StatusFilter }
): Ticket[] {
  const q = opts.query?.trim().toLowerCase()
  const status = opts.status ?? 'all'
  return tickets.filter((t) => {
    if (status !== 'all' && t.status !== status) return false
    if (q) {
      const hay = [t.id, t.subject, ...t.messages.flatMap((m) => [m.body, m.from.name, m.from.email])]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Total number of pages for `total` items (at least 1). */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

/** The slice of items for a zero-based page index. */
export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
  const start = Math.max(0, page) * size
  return items.slice(start, start + size)
}
