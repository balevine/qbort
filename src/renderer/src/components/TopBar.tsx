import { FileUp, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PulseDot } from '@/components/ui/pulse-dot'

interface TopBarProps {
  onOpenSettings: () => void
  onLoadTickets: () => void
  onGenerate: () => void
  generating: boolean
}

/** Single-page top bar: title on the left; GENERATE, LOAD TICKETS, and settings on the right. */
export function TopBar({ onOpenSettings, onLoadTickets, onGenerate, generating }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="border-2 border-ink bg-ink px-2 py-1 font-mono text-sm font-bold uppercase tracking-widest text-paper">
          Ticket Generator
        </span>
        <span className="hidden font-mono text-xs uppercase tracking-widest text-ink/50 sm:inline">
          fake support data
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="solid" onClick={onGenerate}>
          {generating ? <PulseDot /> : <Sparkles className="h-4 w-4" />}
          Generate
        </Button>
        <Button variant="outline" onClick={onLoadTickets}>
          <FileUp className="h-4 w-4" />
          Load Tickets
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    </header>
  )
}
