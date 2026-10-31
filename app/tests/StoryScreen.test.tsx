import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, Completeness, Work } from '../src/types'
import { renderBook } from './bookHarness'
import { NO_DIALOGS } from './serverFixtures'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

const WORK: Work = {
  id: 'w_1',
  title: '책',
  stage: 1,
  locked_stage: 0,
  last_item: null,
  color: null,
  cover_id: null,
  updated_at: '2026-10-31T00:00:00.000Z',
}

const base = {
  work_id: 'w_1',
  status: 'complete',
  source_notes: '',
  evidence: {},
  ai_guess: [],
  pinned: [],
  schema_version: 1,
}
const MAIN = {
  ...base,
  id: 'c_main',
  type: 'main_story',
  name: null,
  data: {
    theme: '상실과 회복',
    premise: '가족의 흔적을 좇는다',
    ending: '새 동료를 얻는다',
    milestones: [
      { id: 'ms_1', order: 1, text: '흔적 발견' },
      { id: 'ms_2', order: 2, text: '진실 대면' },
    ],
  },
} as unknown as Card

function part(id: string, order: number, title: string): Card {
  return {
    ...base,
    id,
    type: 'part',
    name: title,
    data: {
      order,
      title,
      theme: '출발',
      fulfills: [],
      start: '돌아온다',
      end: '떠난다',
      structure: null,
    },
  } as unknown as Card
}

const EP = {
  ...base,
  id: 'c_ep1',
  type: 'episode',
  name: '1화 귀환',
  data: { foreshadowing: { plants: [], payoffs: [] } },
} as unknown as Card

const PORT = { ...base, id: 'c_port', type: 'region', name: '북부 항구' } as unknown as Card
const TEO = { ...base, id: 'c_teo', type: 'character', name: '테오' } as unknown as Card

type Call = { method: string; path: string }
type State = { main?: boolean; parts?: Card[]; assigned?: Record<string, string[]> }

function serve(state: State = {}) {
  const calls: Call[] = []
  const parts = state.parts ?? []
  const completeness: Completeness =
    state.main === false
      ? { milestones: [], foreshadowing: [], incomplete: [] }
      : {
          milestones: [
            {
              id: 'ms_1',
              order: 1,
              text: '흔적 발견',
              parts: state.assigned?.ms_1 ?? [],
              episodes: [],
            },
            {
              id: 'ms_2',
              order: 2,
              text: '진실 대면',
              parts: state.assigned?.ms_2 ?? [],
              episodes: [],
            },
          ],
          foreshadowing: [],
          incomplete: [],
        }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      calls.push({ method, path })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(WORK)
      if (path === '/works/w_1/cards?type=main_story')
        return json({ cards: state.main === false ? [] : [MAIN] })
      if (path === '/works/w_1/cards?type=part') return json({ cards: parts })
      if (path === '/works/w_1/cards?type=episode') return json({ cards: [EP] })
      if (path === '/works/w_1/cards') return json({ cards: [MAIN, ...parts, EP, PORT, TEO] })
      if (path === '/works/w_1/relations?kind=episode_part')
        return json({ relations: [{ from_id: 'c_ep1', to_id: 'c_p1', relation: '1' }] })
      if (path === '/works/w_1/relations?kind=episode_link')
        return json({
          relations: [
            { from_id: 'c_ep0', to_id: 'c_ep1', relation: 'order' },
            { from_id: 'c_ep1', to_id: 'c_ep2', relation: 'order' },
          ],
        })
      if (path === '/works/w_1/relations?kind=episode_region')
        return json({ relations: [{ from_id: 'c_ep1', to_id: 'c_port', relation: 'main' }] })
      if (path === '/works/w_1/relations?kind=episode_character')
        return json({ relations: [{ from_id: 'c_ep1', to_id: 'c_teo', relation: null }] })
      if (path === '/works/w_1/cards?type=region') return json({ cards: [PORT] })
      if (method === 'POST' && path === '/works/w_1/drafts') return json({}, 500)
      if (path === '/works/w_1/completeness') return json(completeness)
      if (path.endsWith('/references')) return json({ references: [] })
      if (method === 'DELETE')
        return json({
          deleted: ['c_p1'],
          restore_until: new Date(Date.now() + 10_000).toISOString(),
        })
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

function renderStory() {
  return renderBook({ name: 'story', workId: 'w_1' })
}

beforeEach(() => {
  useServer.setState({ state: READY })
  window.aiplot = {
    server: {
      get: () => Promise.resolve(READY),
      retry: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    window: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: () => () => undefined,
    },
    dialog: NO_DIALOGS,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const tab = (name: string) => screen.getByRole('tab', { name })

test('without a main story only the first step is open, and it offers to make one', async () => {
  serve({ main: false })
  renderStory()
  expect(await screen.findByText(strings.story.noMain)).toBeTruthy()
  expect(tab(strings.story.stepMain).getAttribute('aria-selected')).toBe('true')
  expect(tab(strings.story.stepParts).hasAttribute('data-later')).toBe(true)
  expect(await screen.findByRole('button', { name: strings.story.createMain })).toBeTruthy()
  fireEvent.click(tab(strings.story.stepParts))
  expect(screen.getByText(strings.story.needMain)).toBeTruthy()
})

test('milestones show their part; an unassigned one keeps the episodes closed', async () => {
  serve({ parts: [part('c_p1', 1, '항구')], assigned: { ms_1: ['c_p1'] } })
  renderStory()
  // The furthest open step comes first: parts.
  expect(await screen.findByText(strings.story.missingMilestones)).toBeTruthy()
  expect(tab(strings.story.stepParts).getAttribute('aria-selected')).toBe('true')
  expect(tab(strings.story.stepEpisodes).hasAttribute('data-later')).toBe(true)
  fireEvent.click(tab(strings.story.stepMain))
  const panel = screen.getByRole('tabpanel')
  expect(within(panel).getByText(strings.story.inPart('제1부 · 항구'))).toBeTruthy()
  expect(within(panel).getByText(strings.story.unassigned)).toBeTruthy()
  fireEvent.click(tab(strings.story.stepEpisodes))
  expect(screen.getByText(strings.story.needParts)).toBeTruthy()
})

test('every milestone in one part opens the timeline: parts, lanes, nodes, completeness', async () => {
  const { calls } = serve({
    parts: [part('c_p2', 2, '남쪽으로'), part('c_p1', 1, '항구')],
    assigned: { ms_1: ['c_p1'], ms_2: ['c_p2'] },
  })
  renderStory()
  expect(
    await screen.findByRole('button', { name: strings.story.openEpisode('1화 귀환') }),
  ).toBeTruthy()
  expect(tab(strings.story.stepEpisodes).getAttribute('aria-selected')).toBe('true')
  // Part bands in order; the last part takes new episodes until another is picked.
  const first = screen.getByRole('button', { name: '제1부 · 항구' })
  expect(
    screen.getByRole('button', { name: '제2부 · 남쪽으로' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(screen.getByText('북부 항구', { selector: '.timeline-lane-name' })).toBeTruthy()
  fireEvent.click(first)
  expect(first.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: strings.story.newEpisodeIn('제1부 · 항구') }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')).toBe(true)
  })
  const panel = screen.getByRole('complementary', { name: strings.story.completeness })
  expect(within(panel).getAllByText(strings.story.noFulfilment)).toHaveLength(2)
})

test('an episode node turns its card; deleting it offers to join its neighbours', async () => {
  const { calls } = serve({
    parts: [part('c_p1', 1, '항구')],
    assigned: { ms_1: ['c_p1'], ms_2: ['c_p1'] },
  })
  renderStory()
  fireEvent.click(
    await screen.findByRole('button', { name: strings.story.openEpisode('1화 귀환') }),
  )
  const card = await screen.findByRole('dialog', { name: '1화 귀환' })
  expect(within(card).getByText('테오')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: strings.story.delete }))
  const dialog = await screen.findByRole('alertdialog')
  const join = within(dialog).getByRole('checkbox', { name: strings.story.reconnect })
  expect(join).toHaveProperty('checked', true)
  fireEvent.click(within(dialog).getByRole('button', { name: strings.cardDelete.delete }))
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/cards/c_ep1?reconnect=true')
  })
})

test('deleting a part with episodes asks, moving them to another part by default', async () => {
  const { calls } = serve({
    parts: [part('c_p1', 1, '항구'), part('c_p2', 2, '남쪽으로')],
    assigned: { ms_1: ['c_p1'] },
  })
  renderStory()
  await screen.findByText(strings.story.missingMilestones)
  const [first] = screen.getAllByRole('button', { name: strings.story.delete })
  if (!first) throw new Error('no delete button')
  fireEvent.click(first)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(strings.cardDelete.partEpisodes(1))).toBeTruthy()
  expect(within(dialog).getByRole('combobox', { name: strings.cardDelete.moveTarget })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: strings.cardDelete.delete }))
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/cards/c_p1?episodes=move%3Ac_p2')
  })
})

test('a part whose episodes the screen missed: the server says so and the dialog asks', async () => {
  let placed = false
  serve({
    parts: [part('c_p1', 1, '항구'), part('c_p2', 2, '남쪽으로')],
    assigned: { ms_1: ['c_p1'] },
  })
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/relations?kind=episode_part'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              relations: placed ? [{ from_id: 'c_ep1', to_id: 'c_p1', relation: '1' }] : [],
            }),
          ),
        )
      if (init?.method === 'DELETE' && !url.includes('episodes=')) {
        placed = true
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'PART_HAS_EPISODES', message: '', hint: null }), {
            status: 409,
          }),
        )
      }
      return base(url, init)
    }),
  )
  renderStory()
  await screen.findByText(strings.story.missingMilestones)
  const [first] = screen.getAllByRole('button', { name: strings.story.delete })
  if (!first) throw new Error('no delete button')
  fireEvent.click(first)
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: strings.cardDelete.delete }))
  expect(await within(dialog).findByText(strings.cardDelete.chooseEpisodes)).toBeTruthy()
  expect(await within(dialog).findByText(strings.cardDelete.partEpisodes(1))).toBeTruthy()
})
