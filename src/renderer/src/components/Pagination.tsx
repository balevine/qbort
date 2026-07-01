import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { clamp } from '@/lib/utils'

interface PaginationProps {
  page: number // zero-based
  pageCount: number
  onPage: (page: number) => void
}

export function Pagination({ page, pageCount, onPage }: PaginationProps) {
  const go = (p: number) => onPage(clamp(p, 0, pageCount - 1))

  return (
    <div className="flex items-center gap-1">
      <IconButton aria-label="First" onClick={() => go(0)} disabled={page <= 0} className="h-8 w-8">
        <ChevronFirst className="h-4 w-4" />
      </IconButton>
      <IconButton aria-label="Previous" onClick={() => go(page - 1)} disabled={page <= 0} className="h-8 w-8">
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <span className="px-2 font-mono text-xs tabular-nums">
        {page + 1} / {pageCount}
      </span>
      <IconButton
        aria-label="Next"
        onClick={() => go(page + 1)}
        disabled={page >= pageCount - 1}
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      <IconButton
        aria-label="Last"
        onClick={() => go(pageCount - 1)}
        disabled={page >= pageCount - 1}
        className="h-8 w-8"
      >
        <ChevronLast className="h-4 w-4" />
      </IconButton>
    </div>
  )
}
