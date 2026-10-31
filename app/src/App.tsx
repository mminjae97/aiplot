import { useEffect, useRef } from 'react'
import { needsSetup, useHealth, useSetupWatcher } from './api/setup'
import { ContentsPage } from './screens/ContentsPage'
import { LibraryScreen } from './screens/LibraryScreen'
import { ServerScreen } from './screens/ServerScreen'
import { SetupScreen } from './screens/SetupScreen'
import { WorldBookScreen } from './screens/WorldBookScreen'
import { useNavigation } from './stores/navigation'
import { useServer } from './stores/server'

/** Screens once the server is up. A first look at /health sends a missing model to S0-1
 * (§12, §13); after "나중에 하기" the library stays usable without it. */
function Connected({ baseUrl }: { baseUrl: string }) {
  const screen = useNavigation((store) => store.screen)
  const open = useNavigation((store) => store.open)
  const health = useHealth()
  const checked = useRef(false)
  useSetupWatcher()

  useEffect(() => {
    if (checked.current || !health.data) return
    checked.current = true
    if (needsSetup(health.data)) open({ name: 'setup' })
  }, [health.data, open])

  if (screen.name === 'setup') return <SetupScreen />
  if (screen.name === 'world') {
    return <WorldBookScreen key={`${baseUrl}:${screen.workId}`} workId={screen.workId} />
  }
  return screen.name === 'contents' ? (
    <ContentsPage key={`${baseUrl}:${screen.workId}`} workId={screen.workId} />
  ) : (
    <LibraryScreen />
  )
}

export function App() {
  const server = useServer((store) => store.state)
  if (server?.status !== 'ready') return <ServerScreen state={server} />
  // Remount on every new connection: a restarted server has a new port and token.
  return <Connected key={server.baseUrl} baseUrl={server.baseUrl} />
}
