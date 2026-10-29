import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const rendererFile = join(__dirname, '../renderer/index.html')
// Dev server URL is honored only in unpackaged (development) runs.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

function isAppUrl(url: string): boolean {
  if (devUrl) return url.startsWith(devUrl)
  return url.startsWith('file://')
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
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
