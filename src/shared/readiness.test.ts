import { describe, expect, it } from 'vitest'
import { providerReadiness } from './readiness'
import { DEFAULT_SETTINGS } from './settings'
import type { Settings } from './types'

const withProvider = (providerId: Settings['providerId'], extra: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  providerId,
  ...extra
})

describe('providerReadiness', () => {
  it('requires an Ollama model', () => {
    expect(providerReadiness(withProvider('ollama', { ollama: { host: 'h', model: '' } }), {}).ready).toBe(false)
    expect(providerReadiness(withProvider('ollama', { ollama: { host: 'h', model: 'llama3.1' } }), {}).ready).toBe(true)
  })

  it('requires a stored key for hosted providers', () => {
    const r = providerReadiness(withProvider('anthropic'), { anthropic: false })
    expect(r.ready).toBe(false)
    expect(r.reason).toMatch(/api key/i)
    expect(providerReadiness(withProvider('anthropic'), { anthropic: true }).ready).toBe(true)
  })
})
