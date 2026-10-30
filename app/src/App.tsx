import { LibraryScreen } from './screens/LibraryScreen'
import { ServerScreen } from './screens/ServerScreen'
import { useServer } from './stores/server'

export function App() {
  const server = useServer((store) => store.state)
  if (server?.status !== 'ready') return <ServerScreen state={server} />
  // Remount on every new connection: a restarted server has a new port and token.
  return <LibraryScreen key={server.baseUrl} />
}
