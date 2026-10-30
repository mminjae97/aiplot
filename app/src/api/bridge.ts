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
}

declare global {
  interface Window {
    aiplot: AiplotBridge
  }
}
