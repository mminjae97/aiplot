import { join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, screen, session, type IpcMainInvokeEvent } from 'electron'
import type { ServerState } from '../src/api/bridge'
import { type ServerCommand, ServerSupervisor } from './processes'
import { minimumWindowSize, type Size } from './windowSize'

const rendererFile = join(__dirname, '../renderer/index.html')
const rendererPath = normalize(rendererFile).toLowerCase()

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

// Dev server URL is honored only in unpackaged (development) runs.
const devUrl = app.isPackaged ? undefined : envValue('ELECTRON_RENDERER_URL')
const devOrigin = devUrl ? parseOrigin(devUrl) : undefined

// All app data, including the Chromium profile, stays under the data dir (§3, §6).
const localAppData = envValue('LOCALAPPDATA') ?? join(app.getPath('home'), 'AppData', 'Local')
const dataDir = resolve(envValue('AIPLOT_DATA_DIR') ?? join(localAppData, 'Aiplot'))
// sessionData defaults to userData.
app.setPath('userData', join(dataDir, 'electron'))

let mainWindow: BrowserWindow | null = null

// Packaged: the PyInstaller build beside the app (step 1 unit 14). Unpackaged: the repo's uv venv
// (run `uv sync` in server/ first).
function serverCommand(): ServerCommand {
  if (app.isPackaged) {
    const dir = join(process.resourcesPath, 'aiplot-server')
    return { executable: join(dir, 'aiplot-server.exe'), args: [], cwd: dir }
  }
  const dir = resolve(app.getAppPath(), '..', 'server')
  return {
    executable: join(dir, '.venv', 'Scripts', 'python.exe'),
    args: ['-m', 'aiplot.main', '--dev'],
    cwd: dir,
  }
}

const server = new ServerSupervisor({
  command: serverCommand(),
  dataDir,
  // `npm run dev` serves the renderer from Vite; the --dev server allows only that origin.
  env: devOrigin ? { ...process.env, AIPLOT_DEV_ORIGIN: devOrigin } : process.env,
  onState: (state: ServerState) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('server:state', state)
  },
})

// Only our own renderer may read the token or restart the server.
function fromApp(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  return frame !== null && frame === mainWindow?.webContents.mainFrame && isAppUrl(frame.url)
}

function parseOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  } catch {
    // reported below
  }
  console.error(`invalid ELECTRON_RENDERER_URL: ${url}`)
  process.exit(1)
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

// The open book never shrinks below its size in a half-screen window (§12 S1). With no menu
// bar the page fills the content area, so the frame is the outer size minus the content size.
function frameOf(win: BrowserWindow): Size {
  const [outerWidth = 0, outerHeight = 0] = win.getSize()
  const [contentWidth = 0, contentHeight = 0] = win.getContentSize()
  return { width: outerWidth - contentWidth, height: outerHeight - contentHeight }
}

// frame is measured once at creation: a minimized window reports a 0x0 content size.
function applyMinimumSize(win: BrowserWindow, frame: Size): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const [outerWidth = 0, outerHeight = 0] = win.getSize()
  const { workArea } = screen.getDisplayMatching(win.getBounds())
  const min = minimumWindowSize(workArea, frame)
  win.setMinimumSize(min.width, min.height)
  // setMinimumSize never grows a window that is already smaller (e.g. moved to a larger
  // display): grow it, keeping it inside the work area.
  if (win.isMaximized() || win.isFullScreen()) return
  if (outerWidth >= min.width && outerHeight >= min.height) return
  const width = Math.max(outerWidth, min.width)
  const height = Math.max(outerHeight, min.height)
  const { x, y } = win.getBounds()
  win.setBounds({
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  })
}

// Without the default menu, unpackaged runs still open DevTools with F12 or Ctrl+Shift+I.
function devToolsKeys(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    if (
      input.type === 'keyDown' &&
      (key === 'f12' || (input.control && input.shift && key === 'i'))
    ) {
      event.preventDefault()
      win.webContents.toggleDevTools()
    }
  })
}

function createWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: Math.min(1440, workAreaSize.width),
    height: Math.min(900, workAreaSize.height),
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
  // Electron's default File/Edit/View menu is not part of the app; its top bar is (§12).
  win.removeMenu()
  if (!app.isPackaged) devToolsKeys(win)
  const frame = frameOf(win)
  const apply = (): void => {
    applyMinimumSize(win, frame)
  }
  apply()
  win.center()
  // Another monitor or resolution changes what half the screen is. 'move' also covers
  // keyboard moves (Win+Shift+arrow), which never send 'moved'; it only recomputes when the
  // window lands on another display.
  let displayId = screen.getDisplayMatching(win.getBounds()).id
  win.on('move', () => {
    if (win.isMinimized()) return
    const id = screen.getDisplayMatching(win.getBounds()).id
    if (id === displayId) return
    displayId = id
    apply()
  })
  win.on('moved', apply)
  win.on('restore', apply)
  win.on('unmaximize', apply)
  const onDisplays = apply
  screen.on('display-metrics-changed', onDisplays)
  win.once('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    screen.off('display-metrics-changed', onDisplays)
    mainWindow = null
  })
  const load = devUrl ? win.loadURL(devUrl) : win.loadFile(rendererFile)
  load.catch((err: unknown) => {
    console.error('renderer load failed', err)
    // Never leave an invisible window holding the single-instance lock.
    if (!win.isDestroyed()) win.show()
  })
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(false)
      })
      session.defaultSession.setPermissionCheckHandler(() => false)
      ipcMain.handle('server:get', (event) => {
        if (!fromApp(event)) throw new Error('not the app window')
        return server.current
      })
      ipcMain.handle('server:retry', (event) => {
        if (!fromApp(event)) throw new Error('not the app window')
        server.retry()
      })
      server.start()
      mainWindow = createWindow()
    })
    .catch((err: unknown) => {
      console.error('startup failed', err)
      app.exit(1)
    })
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('before-quit', () => {
    server.stop()
  })
}
