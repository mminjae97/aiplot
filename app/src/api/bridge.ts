// What preload exposes as window.aiplot (§3 preload.ts: port + token). Shared by electron/ and
// the renderer, so it holds types only.

/** Local server connection as Electron's supervisor sees it (§13). */
export type ServerState =
  | { status: 'starting'; restarts: number }
  | { status: 'ready'; baseUrl: string; token: string; restarts: number }
  // missing: no server executable; failed: it stopped or hung more than 3 times in a row.
  | { status: 'error'; reason: 'missing' | 'failed'; restarts: number }

export interface AiplotBridge {
  server: {
    get(): Promise<ServerState>
    /** Resets the restart budget and starts the server again ("다시 시도"). */
    retry(): Promise<void>
    /** Returns the unsubscribe function. */
    onChange(listener: (state: ServerState) => void): () => void
  }
  /** The top bar is the title bar (§12): its own window buttons. */
  window: {
    minimize(): Promise<void>
    /** Maximizes, or restores a maximized window. */
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    /** Returns the unsubscribe function. */
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
  }
  /** OS dialogs for files the user already has (S0-1); null when cancelled. */
  dialog: {
    pickModel(): Promise<string | null>
    pickFolder(): Promise<string | null>
  }
}

declare global {
  interface Window {
    aiplot: AiplotBridge
  }
}
