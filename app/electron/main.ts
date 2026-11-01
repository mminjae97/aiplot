import { join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import type { ServerState } from '../src/api/bridge'
import { strings } from '../src/strings'
import { type ServerCommand, ServerSupervisor } from './processes'
// The user's logo (app/build/icon.png) trimmed to its rounded square; bundled for the window.
import icon from '../src/assets/logo.png?asset'

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
    // The app's top bar is the title bar (§12): Windows draws no title bar or buttons.
    titleBarStyle: 'hidden',
    // Taskbar and Alt+Tab (§12); the packaged .exe gets build/icon.png from the installer.
    icon,
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
  // The window is always maximized (§12): it is only ever minimized beside that. Whatever
  // restores it to a normal window (Win+arrow keys, snapping) maximizes it again.
  win.on('unmaximize', () => {
    if (!win.isDestroyed() && !win.isMinimized()) win.maximize()
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.on('closed', () => {
    mainWindow = null
  })
  const load = devUrl ? win.loadURL(devUrl) : win.loadFile(rendererFile)
  load.catch((err: unknown) => {
    console.error('renderer load failed', err)
    // Never leave an invisible window holding the single-instance lock.
    if (!win.isDestroyed()) win.maximize()
  })
  return win
}

// Groups the taskbar button under the app, not Electron; the installer (unit 14) uses the same id.
app.setAppUserModelId('com.aiplot.app')

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
      // The top bar's window buttons (§12).
      const appWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
        if (!fromApp(event) || !mainWindow) throw new Error('not the app window')
        return mainWindow
      }
      ipcMain.handle('window:minimize', (event) => {
        appWindow(event).minimize()
      })
      ipcMain.handle('window:close', (event) => {
        appWindow(event).close()
      })
      // Files the user already has (S0-1); the server checks them before use.
      const pick = async (event: IpcMainInvokeEvent, options: OpenDialogOptions) => {
        const result = await dialog.showOpenDialog(appWindow(event), options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
      ipcMain.handle('dialog:pick-model', (event) =>
        pick(event, {
          title: strings.setup.pickModelTitle,
          properties: ['openFile'],
          filters: [{ name: 'GGUF', extensions: ['gguf'] }],
        }),
      )
      ipcMain.handle('dialog:pick-folder', (event) =>
        pick(event, { title: strings.setup.pickFolderTitle, properties: ['openDirectory'] }),
      )
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
