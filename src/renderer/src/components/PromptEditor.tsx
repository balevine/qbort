import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/section-header'
import { Textarea } from '@/components/ui/textarea'
import { useSettings } from '@/state/SettingsContext'
import { DEFAULT_PROMPT } from '@shared/settings'
import { DEFAULT_BATCH_SIZE } from '@shared/generation'
import { compilePrompt } from '@shared/promptCompiler'
import { ensureRoster } from '@shared/staff'

/**
 * Editable prompt + a live "compiled prompt" preview showing exactly what the app would
 * send for one batch (user text + app-enforced requirements).
 */
export function PromptEditor() {
  const { settings, update } = useSettings()
  const [text, setText] = useState(settings?.prompt ?? '')
  const [showPreview, setShowPreview] = useState(false)
  const [copied, setCopied] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  // Sync local text if settings load/change externally.
  useEffect(() => {
    if (settings) setText(settings.prompt)
  }, [settings?.prompt])

  // Debounced persistence so each keystroke doesn't hit disk.
  const onChange = (value: string) => {
    setText(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => update({ prompt: value }), 400)
  }

  const compiled = useMemo(() => {
    if (!settings) return ''
    const gen = settings.generation
    return compilePrompt({
      editablePrompt: text,
      batchCount: Math.min(gen.numTickets, DEFAULT_BATCH_SIZE),
      staff: {
        include: gen.includeStaffResponses,
        avgResponses: gen.avgStaffResponses,
        roster: ensureRoster(settings.staffRoster, gen.numStaffMembers)
      }
    })
  }, [text, settings])

  const copy = async () => {
    await navigator.clipboard.writeText(compiled)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!settings) return null

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
        spellCheck={false}
        placeholder="Describe the tickets to generate: categories, percentages, tone, product details…"
      />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPreview ? 'Hide compiled prompt' : 'Preview compiled prompt'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_PROMPT)}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>

      {showPreview ? (
        <div className="border-2 border-ink bg-paper">
          <SectionHeader
            title="Compiled prompt · one batch"
            action={
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-paper/80 hover:text-paper"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            }
          />
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
            {compiled}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
