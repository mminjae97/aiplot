import { create } from 'zustand'
import type { ServerState } from '../api/bridge'

interface ServerStore {
  // null until preload answers the first time.
  state: ServerState | null
  setState: (state: ServerState) => void
}

export const useServer = create<ServerStore>((set) => ({
  state: null,
  setState: (state) => {
    set({ state })
  },
}))

/** Follows Electron's server supervisor; returns the unsubscribe function. */
export function connectServer(): () => void {
  const { setState } = useServer.getState()
  const unsubscribe = window.aiplot.server.onChange(setState)
  void window.aiplot.server.get().then((state) => {
    // A change event may already have delivered something newer.
    if (useServer.getState().state === null) setState(state)
  })
  return unsubscribe
}
