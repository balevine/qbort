import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettings } from '@/state/SettingsContext'
import { useSecretStatus } from '@/lib/useSecretStatus'
import {
  ALL_PROVIDERS,
  PROVIDER_LABELS,
  isHostedProvider,
  type ConnectionTestResult,
  type ProviderId
} from '@shared/types'
import { cn } from '@/lib/utils'

export function ProviderConfig() {
  const { settings, update } = useSettings()
  const { secretStatus, refresh: refreshSecrets } = useSecretStatus()
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  // Reset transient UI when switching providers.
  useEffect(() => {
    setKeyInput('')
    setTestResult(null)
    setModels([])
  }, [settings?.providerId])

  if (!settings) return null
  const active = settings.providerId
  const hosted = isHostedProvider(active)
  const hasKey = !!secretStatus[active]

  const selectProvider = (id: ProviderId) => update({ providerId: id })

  const saveKey = async () => {
    if (!keyInput.trim()) return
    setSaving(true)
    try {
      await window.api.secrets.setKey(active, keyInput)
      setKeyInput('')
      await refreshSecrets()
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async () => {
    await window.api.secrets.clearKey(active)
    await refreshSecrets()
    setTestResult(null)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.api.provider.testConnection(active))
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async () => {
    setFetchingModels(true)
    try {
      const list = await window.api.ollama.listModels(settings.ollama.host)
      setModels(list)
      if (list.length && !list.includes(settings.ollama.model)) {
        update({ ollama: { ...settings.ollama, model: list[0] } })
      }
    } catch {
      setModels([])
    } finally {
      setFetchingModels(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Provider selector */}
      <div className="grid grid-cols-2 gap-2">
        {ALL_PROVIDERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => selectProvider(id)}
            className={cn(
              'border-2 border-ink px-3 py-2 text-left font-mono text-xs font-bold uppercase tracking-wide transition-colors',
              active === id ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink/10'
            )}
          >
            {PROVIDER_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Hosted: API key */}
      {hosted ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>API key</Label>
            <span
              className={cn(
                'font-mono text-[10px] font-bold uppercase tracking-widest',
                hasKey ? 'text-ink' : 'text-ink/40'
              )}
            >
              {hasKey ? '● key saved' : '○ no key'}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder={hasKey ? 'Replace stored key…' : 'Paste API key…'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <Button variant="solid" onClick={saveKey} disabled={!keyInput.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          {hasKey ? (
            <Button size="sm" variant="ghost" onClick={clearKey}>
              Clear stored key
            </Button>
          ) : null}
        </div>
      ) : (
        /* Ollama: host + model */
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Ollama host</Label>
            <Input
              value={settings.ollama.host}
              placeholder="http://localhost:11434"
              onChange={(e) => update({ ollama: { ...settings.ollama, host: e.target.value } })}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Model</Label>
              <Button size="sm" variant="outline" onClick={fetchModels} disabled={fetchingModels}>
                {fetchingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Fetch models
              </Button>
            </div>
            {models.length > 0 ? (
              <Select
                value={settings.ollama.model || undefined}
                onValueChange={(model) => update({ ollama: { ...settings.ollama, model } })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a model…" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={settings.ollama.model}
                placeholder="e.g. llama3.1 (or Fetch models)"
                onChange={(e) => update({ ollama: { ...settings.ollama, model: e.target.value } })}
              />
            )}
          </div>
        </div>
      )}

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={runTest} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test connection'}
        </Button>
        {testResult ? (
          <span
            className={cn(
              'flex items-center gap-1.5 font-mono text-xs',
              testResult.ok ? 'text-ink' : 'text-ink/70'
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {testResult.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
