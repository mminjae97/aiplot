// The planning book's page order (§8): 목차, then every world book bookmark, the dex's two
// views, the map, and the story steps that are open. Turning a page moves one step along it.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { DexView, PlanningScreen, StoryStep, WorldTab } from '../stores/navigation'

export const WORLD_TABS: WorldTab[] = ['rule', 'faction', 'history', 'culture', 'other', 'terms']
export const STORY_STEPS: StoryStep[] = ['main', 'parts', 'episodes']

// 도감 | 관계도: the last one comes back (a per-viewer convenience; storage may be missing).
const VIEW_KEY = 'aiplot.dex.view'

export function savedView(): DexView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'cards'
  } catch {
    return 'cards'
  }
}

export function saveView(view: DexView) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Not remembered this time; the view itself still changes.
  }
}

export type StorySteps = {
  loaded: boolean
  /** Parts open once a main story is saved; episodes once every milestone is in one part. */
  open: Record<StoryStep, boolean>
  /** The furthest open step: where the story opens when no step is asked for. */
  furthest: StoryStep
}

/** Which story steps are open (§8), from the same queries the story pages use. */
export function useStorySteps(workId: string): StorySteps {
  const mains = useQuery({
    queryKey: ['cards', workId, 'main_story'],
    queryFn: () => api.listCards(workId, { type: 'main_story' }),
  })
  const parts = useQuery({
    queryKey: ['cards', workId, 'part'],
    queryFn: () => api.listCards(workId, { type: 'part' }),
  })
  const completeness = useQuery({
    queryKey: ['completeness', workId],
    queryFn: () => api.completeness(workId),
  })
  const loaded = mains.isSuccess && parts.isSuccess && completeness.isSuccess
  const partsOpen = (mains.data?.cards.length ?? 0) > 0
  const episodesOpen =
    loaded &&
    partsOpen &&
    parts.data.cards.length > 0 &&
    completeness.data.milestones.every((milestone) => milestone.parts.length === 1)
  return {
    loaded,
    open: { main: true, parts: partsOpen, episodes: episodesOpen },
    furthest: episodesOpen ? 'episodes' : partsOpen ? 'parts' : 'main',
  }
}

/** A page with its smallest unit filled in (the screen may leave it to the default). */
export type Page =
  | { name: 'contents' }
  | { name: 'world'; tab: WorldTab }
  | { name: 'characters'; view: DexView }
  | { name: 'regions' }
  | { name: 'story'; step: StoryStep }

/** Every page in reading order; story steps not open yet are skipped. */
export function pagesOf(steps: StorySteps): Page[] {
  return [
    { name: 'contents' },
    ...WORLD_TABS.map((tab) => ({ name: 'world' as const, tab })),
    { name: 'characters', view: 'cards' },
    { name: 'characters', view: 'graph' },
    { name: 'regions' },
    ...STORY_STEPS.filter((step) => steps.open[step]).map((step) => ({
      name: 'story' as const,
      step,
    })),
  ]
}

export function pageOf(screen: PlanningScreen, steps: StorySteps): Page {
  switch (screen.name) {
    case 'contents':
      return { name: 'contents' }
    case 'world':
      return { name: 'world', tab: screen.tab ?? 'rule' }
    case 'characters':
      return { name: 'characters', view: screen.view ?? savedView() }
    case 'regions':
      return { name: 'regions' }
    case 'story': {
      // A step that is (or has become) closed is no page: the story opens at its furthest.
      const asked = screen.step
      const open = asked !== undefined && (!steps.loaded || steps.open[asked])
      return { name: 'story', step: open ? asked : steps.furthest }
    }
  }
}

export const samePage = (a: Page, b: Page) => JSON.stringify(a) === JSON.stringify(b)

export function screenOf(page: Page, workId: string): PlanningScreen {
  return { ...page, workId }
}

/** The post-it notes on the book's edge (§8): one per section, opening its usual page
 * (the section's own default: the remembered dex view, the furthest story step). */
export const SECTIONS = ['contents', 'world', 'characters', 'regions', 'story'] as const
export type Section = (typeof SECTIONS)[number]
