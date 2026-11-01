import { create } from 'zustand'

// The planning book's smallest pages (§8): a world book bookmark, a dex view, a story step.
export type WorldTab = 'rule' | 'faction' | 'history' | 'culture' | 'other' | 'terms'
export type DexView = 'cards' | 'graph'
export type StoryStep = 'main' | 'parts' | 'episodes'

// UI state only (§5): which screen is open. Server data stays in TanStack Query.
export type Screen =
  | { name: 'library' }
  // S0-1 first run (§12)
  | { name: 'setup' }
  | PlanningScreen

/** The pages of one open book (S1 contents and S1-0…S1-3), turned like a book's pages. */
export type PlanningScreen =
  | { name: 'contents'; workId: string }
  // S1-0 world book (§8)
  | { name: 'world'; workId: string; tab?: WorldTab }
  // S1-1 dex (§8); cardId = the card to pick up on arrival (a world book link)
  | { name: 'characters'; workId: string; cardId?: string; view?: DexView }
  // S1-2 region map (§8)
  | { name: 'regions'; workId: string; cardId?: string }
  // S1-3 story (§8)
  | { name: 'story'; workId: string; step?: StoryStep }
  // Stage 2 direction (§9), stage 3 writing (§10) and the reader (S3-2/3): blank pages until
  // their steps; their post-its are already in the book.
  | { name: 'direction'; workId: string }
  | { name: 'writing'; workId: string }
  | { name: 'reading'; workId: string }

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
