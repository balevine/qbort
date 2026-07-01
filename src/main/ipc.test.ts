import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/types'

// Capture the handlers registered on ipcMain, and let the mocked Electron APIs read a temp
// userData dir set up in beforeAll.
const H = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: unknown, ...args: unknown[]) => unknown>,
  userData: ''
}))

vi.mock('electron', () => ({
  app: { getPath: () => H.userData, getVersion: () => '0.1.0' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined as string | undefined }))
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      H.handlers[channel] = fn
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import { registerIpcHandlers } from './ipc'

const fakeEvent = { sender: { isDestroyed: () => false, send: vi.fn() } }
// Async wrapper so a handler that throws synchronously (e.g. input validation) surfaces as a
// rejected promise — matching how Electron's ipcMain.handle relays errors to the renderer.
const invoke = async (channel: string, ...args: unknown[]) => H.handlers[channel](fakeEvent, ...args)

beforeAll(async () => {
  H.userData = await fs.mkdtemp(join(tmpdir(), 'tg-ipc-'))
  registerIpcHandlers()
})
afterAll(async () => {
  await fs.rm(H.userData, { recursive: true, force: true })
})

describe('registerIpcHandlers', () => {
  it('registers a handler for every channel except the send-only progress event', () => {
    for (const channel of Object.values(IpcChannels)) {
      if (channel === IpcChannels.generationProgress) continue
      expect(typeof H.handlers[channel]).toBe('function')
    }
  })

  it('returns the settings document from settings:get', async () => {
    const settings = (await invoke(IpcChannels.settingsGet)) as { providerId: string }
    expect(settings.providerId).toBeDefined()
  })

  it('never returns key material over the secrets channels — only booleans', async () => {
    const KEY = 'sk-super-secret-ABC123'
    expect(await invoke(IpcChannels.secretsSetKey, 'anthropic', KEY)).toBe(true)

    const has = await invoke(IpcChannels.secretsHasKey, 'anthropic')
    const status = await invoke(IpcChannels.secretsStatus)
    expect(has).toBe(true)
    expect(status).toEqual({ anthropic: true })

    // Nothing the renderer can reach echoes the key back.
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(JSON.stringify(has)).not.toContain('secret')
    // There is no channel that returns a decrypted key at all.
    expect(Object.values(IpcChannels)).not.toContain('secrets:getKey')
  })

  it('rejects an unknown provider id on the secrets channel', async () => {
    await expect(invoke(IpcChannels.secretsSetKey, 'evil', 'x')).rejects.toThrow(/unknown provider/i)
    await expect(invoke(IpcChannels.secretsHasKey, 'evil')).rejects.toThrow(/unknown provider/i)
  })

  it('exports nothing when no file is loaded (never trusts a renderer-supplied path)', async () => {
    // The handler takes no source path; with nothing loaded in main it returns null without
    // ever opening a save dialog or copying a file.
    expect(await invoke(IpcChannels.ticketsExport)).toBeNull()
  })
})
