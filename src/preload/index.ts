import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type GenerationProgress, type IpcApi, type ProviderId } from '@shared/types'

/**
 * The allow-listed API surface exposed to the renderer. Nothing else from Node or
 * Electron is reachable from the renderer (contextIsolation + sandbox are on).
 */
const api: IpcApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (partial) => ipcRenderer.invoke(IpcChannels.settingsSet, partial)
  },
  secrets: {
    setKey: (provider: ProviderId, key: string) =>
      ipcRenderer.invoke(IpcChannels.secretsSetKey, provider, key),
    hasKey: (provider: ProviderId) => ipcRenderer.invoke(IpcChannels.secretsHasKey, provider),
    clearKey: (provider: ProviderId) => ipcRenderer.invoke(IpcChannels.secretsClearKey, provider),
    status: () => ipcRenderer.invoke(IpcChannels.secretsStatus)
  },
  provider: {
    testConnection: (provider: ProviderId) =>
      ipcRenderer.invoke(IpcChannels.providerTestConnection, provider)
  },
  ollama: {
    listModels: (host: string) => ipcRenderer.invoke(IpcChannels.ollamaListModels, host)
  },
  generation: {
    estimate: () => ipcRenderer.invoke(IpcChannels.generationEstimate),
    start: () => ipcRenderer.invoke(IpcChannels.generationStart),
    cancel: () => ipcRenderer.invoke(IpcChannels.generationCancel),
    onProgress: (cb: (progress: GenerationProgress) => void) => {
      const listener = (_e: IpcRendererEvent, progress: GenerationProgress) => cb(progress)
      ipcRenderer.on(IpcChannels.generationProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.generationProgress, listener)
    }
  },
  tickets: {
    loadDefault: () => ipcRenderer.invoke(IpcChannels.ticketsLoadDefault),
    open: () => ipcRenderer.invoke(IpcChannels.ticketsOpen),
    export: (sourcePath: string) => ipcRenderer.invoke(IpcChannels.ticketsExport, sourcePath)
  },
  dialog: {
    chooseDirectory: () => ipcRenderer.invoke(IpcChannels.dialogChooseDirectory)
  }
}

contextBridge.exposeInMainWorld('api', api)
