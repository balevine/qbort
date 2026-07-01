import { useCallback, useEffect, useState } from 'react'
import type { SecretStatus } from '@shared/types'

/**
 * Loads the "is a key set?" map for hosted providers on mount and exposes a `refresh` to
 * reload it after a key is saved/cleared. Keys themselves never cross IPC — only booleans.
 */
export function useSecretStatus(): { secretStatus: SecretStatus; refresh: () => Promise<void> } {
  const [secretStatus, setSecretStatus] = useState<SecretStatus>({})

  const refresh = useCallback(async () => {
    try {
      setSecretStatus(await window.api.secrets.status())
    } catch {
      setSecretStatus({})
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { secretStatus, refresh }
}
