import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { TopBar } from '@/components/TopBar'
import { SettingsModal } from '@/components/SettingsModal'
import { GenerateModal } from '@/components/GenerateModal'
import { TicketsView } from '@/components/TicketsView'
import { SettingsProvider } from '@/state/SettingsContext'
import { TicketsProvider, useTickets } from '@/state/TicketsContext'
import { GenerationProvider, useGeneration } from '@/state/GenerationContext'
import { ToastProvider, useToast } from '@/state/ToastContext'
import { errorMessage, formatInt } from '@/lib/format'
import type { AppInfo } from '@shared/types'

function MainArea() {
  const { file } = useTickets()
  if (file) return <TicketsView />
  return (
    <div className="brutal-box max-w-md p-8 text-center">
      <Inbox className="mx-auto h-10 w-10" strokeWidth={1.5} />
      <h1 className="mt-4 font-mono text-lg font-bold uppercase tracking-widest">No tickets loaded</h1>
      <p className="mt-2 text-sm text-ink/60">
        Click <span className="font-bold">Generate</span> to create tickets, or use{' '}
        <span className="font-bold">Load Tickets</span> to open an existing JSON file.
      </p>
    </div>
  )
}

function AppShell() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const { phase } = useGeneration()
  const { setFile } = useTickets()
  const { toast } = useToast()

  const loadTickets = async () => {
    try {
      const loaded = await window.api.tickets.open()
      if (loaded) {
        setFile(loaded.file, loaded.filePath)
        toast(`Loaded ${formatInt(loaded.file.tickets.length)} tickets`)
      }
    } catch (e) {
      toast(errorMessage(e, 'Could not load that file'), 'error')
    }
  }

  // Round-trip through the IPC bridge on mount — proves preload/main wiring works.
  useEffect(() => {
    window.api.app
      .getInfo()
      .then(setAppInfo)
      .catch((err) => console.error('app.getInfo failed', err))
  }, [])

  return (
    <div className="flex h-full flex-col bg-paper">
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        onGenerate={() => setGenerateOpen(true)}
        generating={phase === 'running'}
        onLoadTickets={loadTickets}
      />

      <main className="flex flex-1 items-start justify-center overflow-auto p-8">
        <MainArea />
      </main>

      <footer className="border-t-2 border-ink px-5 py-2 font-mono text-[11px] uppercase tracking-widest text-ink/50">
        {appInfo
          ? `${appInfo.name} v${appInfo.version} · electron ${appInfo.electron} · ${appInfo.platform}`
          : 'connecting to main process…'}
      </footer>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <GenerateModal open={generateOpen} onOpenChange={setGenerateOpen} />
    </div>
  )
}

export function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <TicketsProvider>
          <GenerationProvider>
            <AppShell />
          </GenerationProvider>
        </TicketsProvider>
      </SettingsProvider>
    </ToastProvider>
  )
}
