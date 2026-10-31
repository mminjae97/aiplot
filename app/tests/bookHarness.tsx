import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { PlanningBook } from '../src/screens/PlanningBook'
import { type PlanningScreen, useNavigation } from '../src/stores/navigation'

/** The open book as the app shows it: whatever page the navigation store holds. */
function Book() {
  const screen = useNavigation((store) => store.screen)
  if (screen.name === 'library' || screen.name === 'setup') return null
  return <PlanningBook screen={screen} />
}

/** Opens the book at `screen` (turning pages updates the store, as in the app). */
export function renderBook(screen: PlanningScreen) {
  useNavigation.setState({ screen })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Book />
    </QueryClientProvider>,
  )
}
