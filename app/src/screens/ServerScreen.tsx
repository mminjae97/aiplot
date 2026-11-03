import type { ServerState } from '../api/bridge'
import { TopBar } from '../components/TopBar'
import { strings } from '../strings'

type Props = {
  state: Exclude<ServerState, { status: 'ready' }> | null
}

// The server exits at start when its database was written by a newer app (§14).
const DB_NEWER = /is newer than this app/

function failedText(detail: string | undefined): string {
  if (detail !== undefined && DB_NEWER.test(detail)) return strings.server.dbNewer
  return detail === undefined ? strings.server.failed : strings.server.exited
}

/** Before the local server is up (§12 states): spinner, or the plain cause with "다시 시도". */
export function ServerScreen({ state }: Props) {
  // The top bar stays: it is the window's title bar (move, minimize, close).
  if (state?.status !== 'error') {
    return (
      <div className="screen">
        <TopBar showSetup={false} />
        <main className="server-screen" aria-busy="true">
          <p role="status">{strings.server.starting}</p>
        </main>
      </div>
    )
  }
  return (
    <div className="screen">
      <TopBar showSetup={false} />
      <main className="server-screen">
        <h1>{strings.server.errorTitle}</h1>
        <p>{state.reason === 'missing' ? strings.server.missing : failedText(state.detail)}</p>
        {state.detail !== undefined && (
          <figure className="server-detail">
            <figcaption>{strings.server.detail}</figcaption>
            <pre>{state.detail}</pre>
          </figure>
        )}
        {state.reason === 'failed' && (
          <button
            type="button"
            className="paper-button"
            onClick={() => {
              void window.aiplot.server.retry()
            }}
          >
            {strings.server.retry}
          </button>
        )}
      </main>
    </div>
  )
}
