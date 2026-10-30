import { ContentsPage } from './screens/ContentsPage'
import { LibraryScreen } from './screens/LibraryScreen'
import { ServerScreen } from './screens/ServerScreen'
import { useNavigation } from './stores/navigation'
import { useServer } from './stores/server'

export function App() {
  const server = useServer((store) => store.state)
  const screen = useNavigation((store) => store.screen)
  if (server?.status !== 'ready') return <ServerScreen state={server} />
  // Remount on every new connection: a restarted server has a new port and token.
  return screen.name === 'contents' ? (
    <ContentsPage key={`${server.baseUrl}:${screen.workId}`} workId={screen.workId} />
  ) : (
    <LibraryScreen key={server.baseUrl} />
  )
}
