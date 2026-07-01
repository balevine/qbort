import { FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/state/SettingsContext'

/** Lets the user choose the default folder where ticket JSON files are saved/loaded. */
export function StorageSettings() {
  const { settings, update } = useSettings()
  if (!settings) return null

  const choose = async () => {
    const dir = await window.api.dialog.chooseDirectory()
    if (dir) update({ defaultDir: dir })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-2 border-ink bg-paper px-3 py-2">
        <FolderOpen className="h-4 w-4 shrink-0 text-ink/60" />
        <span className="truncate font-mono text-xs text-ink" title={settings.defaultDir ?? ''}>
          {settings.defaultDir ?? 'App default folder (userData)'}
        </span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={choose}>
          <FolderOpen className="h-3.5 w-3.5" />
          Choose folder
        </Button>
        {settings.defaultDir ? (
          <Button size="sm" variant="ghost" onClick={() => update({ defaultDir: null })}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </Button>
        ) : null}
      </div>
    </div>
  )
}
