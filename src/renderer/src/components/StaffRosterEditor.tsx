import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/state/SettingsContext'
import { STAFF_EMAIL_DOMAIN, normalizeAliasAt, generateStaffMember } from '@shared/staff'
import type { StaffMember } from '@shared/types'

/**
 * Editable staff roster. Each row is a name + alias; the email is derived as
 * `alias@company.biz`. Adding/removing rows keeps `numStaffMembers` in sync.
 */
export function StaffRosterEditor() {
  const { settings, update } = useSettings()
  if (!settings) return null

  const roster = settings.staffRoster

  const commit = (next: StaffMember[]) =>
    update({
      staffRoster: next,
      generation: { ...settings.generation, numStaffMembers: next.length }
    })

  const updateRow = (index: number, patch: Partial<StaffMember>) => {
    const next = roster.map((m, i) => (i === index ? { ...m, ...patch } : m))
    // Don't resync count for in-place edits; only persist the roster.
    update({ staffRoster: next })
  }

  const normalizeRow = (index: number) => {
    const alias = normalizeAliasAt(roster, index)
    if (alias !== roster[index].alias) updateRow(index, { alias })
  }

  const addRow = () => commit([...roster, generateStaffMember(roster.length)])
  const removeRow = (index: number) =>
    commit(roster.filter((_, i) => i !== index))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink/50">
          {roster.length} member(s) · all on <span className="font-bold">@{STAFF_EMAIL_DOMAIN}</span>
        </p>
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {roster.map((member, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input
              aria-label={`Staff name ${i + 1}`}
              placeholder="Full name"
              value={member.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              className="h-9"
            />
            <div className="relative">
              <Input
                aria-label={`Staff alias ${i + 1}`}
                placeholder="alias"
                value={member.alias}
                onChange={(e) => updateRow(i, { alias: e.target.value })}
                onBlur={() => normalizeRow(i)}
                className="h-9 pr-[7.5rem]"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ink/40">
                @{STAFF_EMAIL_DOMAIN}
              </span>
            </div>
            <IconButton
              aria-label={`Remove staff ${i + 1}`}
              onClick={() => removeRow(i)}
              disabled={roster.length <= 1}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}
