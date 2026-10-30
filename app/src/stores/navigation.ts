import { create } from 'zustand'

// UI state only (§5): which screen is open. Server data stays in TanStack Query.
export type Screen = { name: 'library' } | { name: 'contents'; workId: string }

interface NavigationStore {
  screen: Screen
  // A just-made or just-opened book gets a short highlight on the shelf (§12 S0).
  highlight: string | null
  open: (screen: Screen) => void
}

export const useNavigation = create<NavigationStore>((set) => ({
  screen: { name: 'library' },
  highlight: null,
  open: (screen) => {
    set({ screen, highlight: screen.name === 'contents' ? screen.workId : null })
  },
}))
