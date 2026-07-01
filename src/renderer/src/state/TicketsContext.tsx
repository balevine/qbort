import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TicketFile } from '@shared/types'
import { createSafeContext } from '@/lib/createSafeContext'

interface TicketsContextValue {
  file: TicketFile | null
  filePath: string | null
  setFile: (file: TicketFile, filePath: string | null) => void
  clear: () => void
}

const [TicketsContext, useTickets] = createSafeContext<TicketsContextValue>('Tickets')
export { useTickets }

export function TicketsProvider({ children }: { children: ReactNode }) {
  const [file, setFileState] = useState<TicketFile | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)

  // Auto-load the default/last tickets file on launch.
  useEffect(() => {
    let active = true
    window.api.tickets
      .loadDefault()
      .then((loaded) => {
        if (active && loaded) {
          setFileState(loaded.file)
          setFilePath(loaded.filePath)
        }
      })
      .catch((err) => console.error('tickets.loadDefault failed', err))
    return () => {
      active = false
    }
  }, [])

  const value = useMemo<TicketsContextValue>(
    () => ({
      file,
      filePath,
      setFile: (f, p) => {
        setFileState(f)
        setFilePath(p)
      },
      clear: () => {
        setFileState(null)
        setFilePath(null)
      }
    }),
    [file, filePath]
  )

  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>
}
