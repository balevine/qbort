import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'

const isDev = !app.isPackaged

/**
 * Content-Security-Policy applied to every renderer response (defense in depth).
 * Dev needs inline scripts/styles and a websocket for Vite HMR + React Fast Refresh;
 * production locks everything down to local resources. All external network calls happen
 * in the main process, so the renderer never needs a broad `connect-src`.
 */
// Shared hardening directives: no plugins, no embedding, no `<base>` hijack, no form posts.
// All network calls happen in main, so the renderer never needs to embed or submit anywhere.
const CSP_LOCKS = ["object-src 'none'", "base-uri 'none'", "frame-src 'none'", "form-action 'none'"]

const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' http://localhost:*",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  ...CSP_LOCKS
].join('; ')

const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  ...CSP_LOCKS
].join('; ')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Qbort',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the user's browser, never in an Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-app navigation to remote origins.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL']
    if (allowed && url.startsWith(allowed)) return
    event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? CSP_DEV : CSP_PROD]
      }
    })
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
