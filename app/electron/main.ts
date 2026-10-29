import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const rendererFile = join(__dirname, '../renderer/index.html')
// Dev server URL is honored only in unpackaged (development) runs.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    if (devUrl) return target.origin === new URL(devUrl).origin
    if (target.protocol !== 'file:') return false
    return normalize(fileURLToPath(target)).toLowerCase() === normalize(rendererFile).toLowerCase()
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  const guard = (details: Electron.Event<{ url: string }>): void => {
    if (!isAppUrl(details.url)) details.preventDefault()
  }
  // will-frame-navigate also fires for the main frame.
  win.webContents.on('will-frame-navigate', guard)
  win.webContents.on('will-redirect', guard)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    mainWindow = null
  })
  // Error screen with retry arrives with the server lifecycle (step 1, unit 7).
  const load = devUrl ? win.loadURL(devUrl) : win.loadFile(rendererFile)
  load.catch((err: unknown) => {
    console.error('renderer load failed', err)
  })
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(() => {
    mainWindow = createWindow()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
}
