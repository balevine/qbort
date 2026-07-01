import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SliderField } from '@/components/ui/slider-field'
import { useSettings } from '@/state/SettingsContext'
import { LIMITS } from '@shared/settings'
import { resizeRoster } from '@shared/staff'

/** Numeric generation settings: ticket count, staff-response options, staff count. */
export function SettingsPanel() {
  const { settings, update } = useSettings()
  if (!settings) return null

  const gen = settings.generation

  return (
    <div className="space-y-5">
      <SliderField
        label="Number of tickets"
        value={gen.numTickets}
        min={LIMITS.numTickets.min}
        max={LIMITS.numTickets.max}
        onChange={(numTickets) => update({ generation: { ...gen, numTickets } })}
      />

      <div className="flex items-center justify-between border-t-2 border-ink/10 pt-4">
        <div>
          <Label>Include staff responses</Label>
          <p className="mt-1 text-xs text-ink/50">
            When off, tickets have no staff replies regardless of the average below.
          </p>
        </div>
        <Switch
          aria-label="Include staff responses"
          checked={gen.includeStaffResponses}
          onCheckedChange={(includeStaffResponses) =>
            update({ generation: { ...gen, includeStaffResponses } })
          }
        />
      </div>

      <SliderField
        label="Average staff responses / ticket"
        value={gen.avgStaffResponses}
        min={LIMITS.avgStaffResponses.min}
        max={LIMITS.avgStaffResponses.max}
        disabled={!gen.includeStaffResponses}
        onChange={(avgStaffResponses) => update({ generation: { ...gen, avgStaffResponses } })}
      />

      <SliderField
        label="Number of staff members"
        value={gen.numStaffMembers}
        min={LIMITS.numStaffMembers.min}
        max={LIMITS.numStaffMembers.max}
        hint="resizes the roster below"
        onChange={(numStaffMembers) =>
          update({
            generation: { ...gen, numStaffMembers },
            staffRoster: resizeRoster(settings.staffRoster, numStaffMembers)
          })
        }
      />
    </div>
  )
}
