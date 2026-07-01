import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isStaffEmail } from '@shared/staff'
import type { Ticket, TicketAuthor } from '@shared/types'
import { cn } from '@/lib/utils'

interface TicketModalProps {
  ticket: Ticket | null
  /** Position of this ticket within the filtered list (0-based) and the total count. */
  index: number
  total: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

interface Message {
  body: string
  from: TicketAuthor
  staff: boolean
}

/** Conversation modal with prev/next navigation through the filtered list. */
export function TicketModal({ ticket, index, total, onClose, onPrev, onNext }: TicketModalProps) {
  if (!ticket) return null

  const hasPrev = index > 0
  const hasNext = index < total - 1

  const messages: Message[] = [
    { body: ticket.body, from: ticket.from, staff: isStaffEmail(ticket.from.email) },
    ...ticket.responses.map((r) => ({
      body: r.body,
      from: r.from,
      staff: isStaffEmail(r.from.email)
    }))
  ]

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault()
      onNext()
    } else if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault()
      onPrev()
    }
  }

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[80vh] max-w-2xl" onKeyDown={onKeyDown} aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <span className="font-mono text-[11px] text-paper/60">{ticket.id}</span>
            <DialogTitle className="truncate normal-case tracking-normal">{ticket.subject}</DialogTitle>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-paper/60">
            <span className="border border-paper/40 px-1.5 py-0.5">{ticket.status}</span>
            <span>{messages.length} message(s)</span>
          </div>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 space-y-3 bg-ink/[0.03]">
          {messages.map((m, i) => (
            <div key={i} className={cn('border-2 border-ink p-3', m.staff ? 'bg-staff/60' : 'bg-paper')}>
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-ink/60">
                <span className="truncate">
                  {m.from.name} &lt;{m.from.email}&gt;
                </span>
                <span className="font-bold uppercase tracking-widest">
                  {m.staff ? 'Staff' : 'Customer'}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.body}</p>
            </div>
          ))}
        </DialogBody>

        {/* Prev / next navigation */}
        <div className="flex items-center justify-between border-t-2 border-ink px-5 py-2">
          <Button variant="outline" size="sm" onClick={onPrev} disabled={!hasPrev}>
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="font-mono text-[11px] tabular-nums text-ink/50">
            {index + 1} / {total}
          </span>
          <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
