import type { ServerState } from '../api/bridge'
import { strings } from '../strings'

type Props = {
  state: Exclude<ServerState, { status: 'ready' }> | null
}

/** Before the local server is up (§12 states): spinner, or the plain cause with "다시 시도". */
export function ServerScreen({ state }: Props) {
  if (state?.status !== 'error') {
    return (
      <main className="server-screen" aria-busy="true">
        <p role="status">{strings.server.starting}</p>
      </main>
    )
  }
  return (
    <main className="server-screen">
      <h1>{strings.server.errorTitle}</h1>
      <p>{state.reason === 'missing' ? strings.server.missing : strings.server.failed}</p>
      {state.reason === 'failed' && (
        <button
          type="button"
          onClick={() => {
            void window.aiplot.server.retry()
          }}
        >
          {strings.server.retry}
        </button>
      )}
    </main>
  )
}
