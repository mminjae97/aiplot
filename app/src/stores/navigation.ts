import { create } from 'zustand'

// UI state only (§5): which screen is open. Server data stays in TanStack Query.
export type Screen =
  | { name: 'library' }
  | { name: 'contents'; workId: string }
  // S0-1 first run (§12)
  | { name: 'setup' }
  // S1-0 world book (§8)
  | { name: 'world'; workId: string }
  // S1-1 dex (§8); cardId = the card to pick up on arrival (a world book link)
  | { name: 'characters'; workId: string; cardId?: string }
  // S1-2 region map (§8)
  | { name: 'regions'; workId: string; cardId?: string }
  // S1-3 story (§8)
  | { name: 'story'; workId: string }

interface NavigationStore {
  screen: Screen
  // The book just made or opened gets a short lift when the shelf shows again (§12 S0).
  highlight: string | null
  open: (screen: Screen) => void
}

export const useNavigation = create<NavigationStore>((set) => ({
  screen: { name: 'library' },
  highlight: null,
  open: (screen) => {
    set((store) => ({
      screen,
      highlight:
        screen.name === 'contents'
          ? screen.workId
          : store.screen.name === 'contents'
            ? store.screen.workId
            : store.highlight,
    }))
  },
}))
