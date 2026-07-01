import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'
import { createSafeContext } from '@/lib/createSafeContext'

interface SettingsContextValue {
  settings: Settings | null
  loading: boolean
  /** Persist a partial update; returns the merged settings from main. */
  update: (partial: Partial<Settings>) => Promise<void>
}

const [SettingsContext, useSettings] = createSafeContext<SettingsContextValue>('Settings')
export { useSettings }

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    window.api.settings
      .get()
      .then((s) => {
        if (active) setSettings(s)
      })
      .catch((err) => console.error('settings.get failed', err))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const update = useCallback(async (partial: Partial<Settings>) => {
    // Optimistic local update for snappy UI, then reconcile with main's merged result.
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
    const next = await window.api.settings.set(partial)
    setSettings(next)
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, loading, update }}>
      {children}
    </SettingsContext.Provider>
  )
}
