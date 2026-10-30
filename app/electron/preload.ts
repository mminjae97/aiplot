import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiplotBridge, ServerState } from '../src/api/bridge'

// The renderer reaches the local server only through this: port + token (§3).
const bridge: AiplotBridge = {
  server: {
    get: () => ipcRenderer.invoke('server:get') as Promise<ServerState>,
    retry: () => ipcRenderer.invoke('server:retry') as Promise<void>,
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: ServerState): void => {
        listener(state)
      }
      ipcRenderer.on('server:state', handler)
      return () => {
        ipcRenderer.removeListener('server:state', handler)
      }
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<void>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    onMaximizedChange: (listener) => {
      const handler = (_event: IpcRendererEvent, maximized: boolean): void => {
        listener(maximized)
      }
      ipcRenderer.on('window:maximized', handler)
      return () => {
        ipcRenderer.removeListener('window:maximized', handler)
      }
    },
  },
}

contextBridge.exposeInMainWorld('aiplot', bridge)
