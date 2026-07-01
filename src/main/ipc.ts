import { promises as fs } from 'fs'
import { join } from 'path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { ALL_PROVIDERS, IpcChannels, type ProviderId } from '@shared/types'
import { SettingsStore } from './settings'
import { SecretStore } from './secrets'
import { listOllamaModels, testConnection } from './connection'
import { GenerationService } from './generation/service'
import { DEFAULT_TICKETS_FILENAME, TicketStore, resolveOutputDir } from './storage'

/** Show a native dialog parented to the sender's window when possible, else app-modal. */
function showOpen(sender: Electron.WebContents, options: Electron.OpenDialogOptions) {
  const win = BrowserWindow.fromWebContents(sender)
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}
function showSave(sender: Electron.WebContents, options: Electron.SaveDialogOptions) {
  const win = BrowserWindow.fromWebContents(sender)
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

/** Validate an untrusted provider id from the renderer before it reaches the store/adapters. */
function assertProviderId(value: unknown): ProviderId {
  if (typeof value === 'string' && (ALL_PROVIDERS as string[]).includes(value)) {
    return value as ProviderId
  }
  throw new Error(`Unknown provider: ${String(value)}`)
}

/**
 * Registers all IPC handlers. Keep every channel here and allow-listed in the preload
 * bridge — the renderer can only reach what is explicitly exposed.
 */
export function registerIpcHandlers(): void {
  const userData = app.getPath('userData')
  const settings = new SettingsStore(userData)
  const secrets = new SecretStore(userData)
  const generation = new GenerationService(settings, secrets, userData, app.getVersion())

  // The path of the file currently loaded in the view — set only by the main process (load /
  // open / generate). Export copies *this*, never a path handed in by the renderer, so a buggy
  // or compromised renderer can't turn export into an arbitrary-file read.
  let loadedPath: string | null = null

  // --- Settings ---------------------------------------------------------------
  ipcMain.handle(IpcChannels.settingsGet, () => settings.get())
  ipcMain.handle(IpcChannels.settingsSet, (_e, partial) => settings.set(partial))

  // --- Secrets (keys never returned to the renderer) --------------------------
  ipcMain.handle(IpcChannels.secretsSetKey, (_e, provider: unknown, key: unknown) =>
    secrets.setKey(assertProviderId(provider), String(key ?? ''))
  )
  ipcMain.handle(IpcChannels.secretsHasKey, (_e, provider: unknown) =>
    secrets.hasKey(assertProviderId(provider))
  )
  ipcMain.handle(IpcChannels.secretsClearKey, (_e, provider: unknown) =>
    secrets.clearKey(assertProviderId(provider))
  )
  ipcMain.handle(IpcChannels.secretsStatus, () => secrets.status())

  // --- Provider connectivity --------------------------------------------------
  ipcMain.handle(IpcChannels.providerTestConnection, async (_e, provider: unknown) => {
    const current = await settings.get()
    return testConnection(assertProviderId(provider), {
      host: current.ollama.host,
      getKey: (p) => secrets.getKey(p)
    })
  })
  ipcMain.handle(IpcChannels.ollamaListModels, (_e, host: string) => listOllamaModels(host))

  // --- Generation -------------------------------------------------------------
  ipcMain.handle(IpcChannels.generationEstimate, () => generation.estimate())
  ipcMain.handle(IpcChannels.generationStart, async (e) => {
    const result = await generation.start((progress) => {
      if (!e.sender.isDestroyed()) e.sender.send(IpcChannels.generationProgress, progress)
    })
    loadedPath = result.filePath
    return result
  })
  ipcMain.handle(IpcChannels.generationCancel, () => {
    generation.cancel()
  })

  // --- Tickets (load / open / export) -----------------------------------------
  ipcMain.handle(IpcChannels.ticketsLoadDefault, async () => {
    const s = await settings.get()
    const path = s.lastOutputPath || join(resolveOutputDir(s, userData), DEFAULT_TICKETS_FILENAME)
    const file = await TicketStore.readFile(path)
    if (!file) return null
    loadedPath = path
    return { file, filePath: path }
  })

  ipcMain.handle(IpcChannels.ticketsOpen, async (e) => {
    const s = await settings.get()
    const result = await showOpen(e.sender, {
      title: 'Open tickets file',
      defaultPath: resolveOutputDir(s, userData),
      filters: [{ name: 'Tickets JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null // user cancelled — not an error
    const file = await TicketStore.readFile(path)
    if (!file) throw new Error('That file is not a valid tickets JSON file.')
    await settings.set({ lastOutputPath: path })
    loadedPath = path
    return { file, filePath: path }
  })

  ipcMain.handle(IpcChannels.ticketsExport, async (e) => {
    // Export the file the main process knows is loaded — never a path supplied by the renderer.
    if (!loadedPath) return null
    const result = await showSave(e.sender, {
      title: 'Export tickets',
      defaultPath: 'tickets.json',
      filters: [{ name: 'Tickets JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fs.copyFile(loadedPath, result.filePath)
    return result.filePath
  })

  // --- Native dialogs ---------------------------------------------------------
  ipcMain.handle(IpcChannels.dialogChooseDirectory, async (e) => {
    const result = await showOpen(e.sender, {
      title: 'Choose default folder for ticket files',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
