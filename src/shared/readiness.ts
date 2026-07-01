import { PROVIDER_LABELS, type SecretStatus, type Settings } from './types'

export interface Readiness {
  ready: boolean
  reason?: string
}

/**
 * Whether the active provider is configured enough to run: Ollama needs a selected model,
 * hosted providers need a stored API key. Returns a user-facing reason when not ready.
 */
export function providerReadiness(settings: Settings, secretStatus: SecretStatus): Readiness {
  const id = settings.providerId
  if (id === 'ollama') {
    if (!settings.ollama.model.trim()) {
      return { ready: false, reason: 'Select an Ollama model in Settings → Provider.' }
    }
    return { ready: true }
  }
  if (!secretStatus[id]) {
    return { ready: false, reason: `Add an API key for ${PROVIDER_LABELS[id]} in Settings → Provider.` }
  }
  return { ready: true }
}
