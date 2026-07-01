import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ProviderConfig } from '@/components/ProviderConfig'
import { SettingsPanel } from '@/components/SettingsPanel'
import { StaffRosterEditor } from '@/components/StaffRosterEditor'
import { PromptEditor } from '@/components/PromptEditor'
import { StorageSettings } from '@/components/StorageSettings'
import { cn } from '@/lib/utils'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Tab {
  id: string
  label: string
  note?: string
  render: () => ReactNode
}

const TABS: Tab[] = [
  {
    id: 'provider',
    label: 'Provider',
    note: 'Ollama is local; hosted providers need an API key.',
    render: () => <ProviderConfig />
  },
  {
    id: 'generation',
    label: 'Generation',
    note: 'Ticket count, staff responses, and staff count.',
    render: () => <SettingsPanel />
  },
  {
    id: 'staff',
    label: 'Staff',
    note: 'Authors of staff responses. Email = alias@company.biz.',
    render: () => <StaffRosterEditor />
  },
  {
    id: 'prompt',
    label: 'Prompt',
    note: 'Your creative/distribution prompt + a compiled preview.',
    render: () => <PromptEditor />
  },
  {
    id: 'storage',
    label: 'Storage',
    note: 'Where ticket JSON files are saved and auto-loaded.',
    render: () => <StorageSettings />
  }
]

/** Tabbed settings modal — a menu across the top, one section visible at a time. */
export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeId, setActiveId] = useState(TABS[0].id)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Start on the first tab each time the modal opens.
  useEffect(() => {
    if (open) setActiveId(TABS[0].id)
  }, [open])

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === activeId))
  const active = TABS[activeIndex]

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next = activeIndex
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    setActiveId(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[80vh] max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* Tab strip */}
        <div
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={onKeyDown}
          className="flex flex-wrap gap-px border-b-2 border-ink bg-ink"
        >
          {TABS.map((tab, i) => {
            const selected = tab.id === activeId
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  'px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-widest transition-colors',
                  selected ? 'bg-paper text-ink' : 'bg-ink text-paper/70 hover:text-paper'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <DialogBody
          role="tabpanel"
          id={`panel-${active.id}`}
          aria-labelledby={`tab-${active.id}`}
          className="min-h-0 flex-1"
        >
          {active.note ? <p className="mb-4 text-xs text-ink/50">{active.note}</p> : null}
          {active.render()}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
