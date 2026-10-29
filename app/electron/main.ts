import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, session } from 'electron'

const rendererFile = join(__dirname, '../renderer/index.html')
// Dev server URL is honored only in unpackaged (development) runs.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const devOrigin = devUrl ? parseOrigin(devUrl) : undefined
const rendererPath = normalize(rendererFile).toLowerCase()

// All app data, including Chromium profile data, stays under the data dir (��3, ��6).
const dataDir =
  process.env.AIPLOT_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'Aiplot')
app.setPath('userData', join(dataDir, 'electron'))
app.setPath('sessionData', join(dataDir, 'electron'))

let mainWindow: BrowserWindow | null = null

function parseOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new Error(`invalid ELECTRON_RENDERER_URL: ${url}`)
  }
}

function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    if (devOrigin) return target.origin === devOrigin
    if (target.protocol !== 'file:') return false
    return normalize(fileURLToPath(target)).toLowerCase() === rendererPath
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
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
  win.once('ready-to-show', () => {
    win.show()
  })
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
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(false)
      })
      session.defaultSession.setPermissionCheckHandler(() => false)
      mainWindow = createWindow()
    })
    .catch((err: unknown) => {
      console.error('startup failed', err)
      app.exit(1)
    })
  app.on('window-all-closed', () => {
    app.quit()
  })
}
