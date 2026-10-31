import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import { DESK_MARGIN, TOP_BAR_HEIGHT } from './styles/metrics'
import './styles/library.css'
import './styles/contents.css'
import './styles/setup.css'
import './styles/drawer.css'
import './styles/worldbook.css'
import { connectServer } from './stores/server'

const container = document.getElementById('root')
if (!container) throw new Error('root element missing')

// The server is local: surface errors at once (§12 shows cause + retry) and skip focus refetches.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

connectServer()

// One source for sizes the CSS and Electron's minimum window share.
document.documentElement.style.setProperty('--top-bar', `${String(TOP_BAR_HEIGHT)}px`)
document.documentElement.style.setProperty('--desk-margin', `${String(DESK_MARGIN)}px`)

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
