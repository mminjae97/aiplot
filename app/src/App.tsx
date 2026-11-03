import { useEffect, useRef } from 'react'
import { needsSetup, setupOpens, useHealth, useSetupWatcher } from './api/setup'
import { LibraryScreen } from './screens/LibraryScreen'
import { PlanningBook } from './screens/PlanningBook'
import { ServerScreen } from './screens/ServerScreen'
import { SetupScreen } from './screens/SetupScreen'
import { useNavigation } from './stores/navigation'
import { useServer } from './stores/server'
import type { HealthResponse } from './types'

/** Screens once the server is up. /health saying llama.cpp or the model is missing, or
 * llama-server failed, sends the user to S0-1 (§12, §13), at boot or whenever it fails later:
 * at once from the library; inside a book only a top-bar chip, and S0-1 on the way back to the
 * library. After "나중에 하기" the library stays usable until llama fails anew. */
function Connected({ baseUrl }: { baseUrl: string }) {
  const screen = useNavigation((store) => store.screen)
  const setupFailed = useNavigation((store) => store.setupFailed)
  const setupRecovered = useNavigation((store) => store.setupRecovered)
  const health = useHealth()
  const previous = useRef<HealthResponse | null>(null)
  useSetupWatcher()

  useEffect(() => {
    if (!health.data) return
    if (setupOpens(previous.current, health.data)) setupFailed()
    else if (!needsSetup(health.data)) setupRecovered()
    previous.current = health.data
  }, [health.data, setupFailed, setupRecovered])

  if (screen.name === 'setup') return <SetupScreen />
  if (screen.name === 'library') return <LibraryScreen />
  // One open book for all its pages, so a turn animates instead of remounting the book.
  return <PlanningBook key={`${baseUrl}:${screen.workId}`} screen={screen} />
}

export function App() {
  const server = useServer((store) => store.state)
  if (server?.status !== 'ready') return <ServerScreen state={server} />
  // Remount on every new connection: a restarted server has a new port and token.
  return <Connected key={server.baseUrl} baseUrl={server.baseUrl} />
}
