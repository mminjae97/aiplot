import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, RegionCard, Work } from '../src/types'
import { renderBook } from './bookHarness'
import { NO_DIALOGS } from './serverFixtures'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

function work(lockedStage: 0 | 1 = 0): Work {
  return {
    id: 'w_1',
    title: '책',
    stage: lockedStage === 0 ? 1 : 2,
    locked_stage: lockedStage,
    last_item: null,
    color: null,
    cover_id: null,
    updated_at: '2026-10-31T00:00:00.000Z',
  }
}

function region(id: string, name: string, data: Partial<RegionCard['data']> = {}): RegionCard {
  return {
    id,
    work_id: 'w_1',
    type: 'region',
    name,
    status: 'complete',
    source_notes: '',
    data: {
      parent_id: null,
      links: [],
      appearance: `${name}의 겉모습`,
      environment: { natural: '한랭한 해안', social: '밀수꾼이 많다' },
      sensory: { smell: null, sound: null, mood: '음울함' },
      ...data,
    },
    evidence: {},
    ai_guess: [],
    pinned: [],
    schema_version: 1,
    position: null,
  }
}

const PORT = region('c_port', '북부 항구')
const CAPITAL = region('c_capital', '왕도')
const NORTH = region('c_north', '북부 왕국')
const EPISODE = {
  id: 'c_ep1',
  type: 'episode',
  name: '1화 귀환',
  data: { foreshadowing: { plants: [], payoffs: [] } },
} as unknown as Card
const TIDE = {
  id: 'c_tide',
  work_id: 'w_1',
  type: 'world',
  name: '조수 마법',
  status: 'complete',
  data: { category: 'rule', summary: '', details: null, rules: [], terms: [], related: [] },
} as unknown as Card

type Call = { method: string; path: string; body: unknown }

function serve(options: { locked?: boolean } = {}) {
  const calls: Call[] = []
  const regions: Card[] = [PORT, CAPITAL, NORTH]
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ method, path, body })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(work(options.locked ? 1 : 0))
      if (path === '/works/w_1/cards?type=region') return json({ cards: regions })
      if (path === '/works/w_1/cards?type=world') return json({ cards: [TIDE] })
      if (path === '/works/w_1/cards') return json({ cards: [...regions, EPISODE, TIDE] })
      if (path === '/works/w_1/region-links')
        return json({
          links: [
            {
              from_id: 'c_port',
              to_id: 'c_capital',
              travel: { value: 3, unit: 'day', mode: '말' },
              direction: '남',
            },
          ],
        })
      if (path === '/works/w_1/relations?kind=parent')
        return json({ relations: [{ from_id: 'c_port', to_id: 'c_north', relation: null }] })
      if (path === '/works/w_1/relations?kind=episode_region')
        return json({ relations: [{ from_id: 'c_ep1', to_id: 'c_port', relation: 'main' }] })
      if (path === '/works/w_1/relations?kind=world')
        return json({ relations: [{ from_id: 'c_tide', to_id: 'c_port', relation: null }] })
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

async function nodes(kind: 'region' | 'area') {
  await waitFor(() => {
    expect(document.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0)
  })
  return [...document.querySelectorAll<HTMLElement>(`.react-flow__node-${kind}`)]
}

beforeEach(() => {
  useServer.setState({ state: READY })
  useNavigation.setState({ screen: { name: 'contents', workId: 'w_1' } })
  window.aiplot = {
    server: {
      get: () => Promise.resolve(READY),
      retry: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    window: {
      minimize: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
    dialog: NO_DIALOGS,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a token per region, the parent as an area, the episode count as a badge', async () => {
  serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  expect((await nodes('region')).map((node) => node.dataset.id)).toEqual(['c_port', 'c_capital'])
  expect((await nodes('area')).map((node) => node.dataset.id)).toEqual(['c_north'])
  const port = (await nodes('region'))[0]
  expect(port?.querySelector('.map-badge')?.getAttribute('aria-label')).toBe(
    strings.map.episodes(1),
  )
  expect(screen.getByText(strings.map.hint)).toBeTruthy()
})

test('Enter on a region turns its card: senses, journeys, parent and episodes', async () => {
  serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  const [port] = await nodes('region')
  if (!port) throw new Error('no node')
  fireEvent.keyDown(port, { key: 'Enter' })
  const dialog = await screen.findByRole('dialog', { name: '북부 항구' })
  const card = dialog.querySelector<HTMLElement>('.flip-back')
  if (!card) throw new Error('no back')
  for (const text of ['북부 항구의 겉모습', '한랭한 해안', '밀수꾼이 많다', '음울함', '1화 귀환'])
    expect(within(card).getByText(text)).toBeTruthy()
  expect(within(card).getByText('북부 왕국')).toBeTruthy()
  expect(within(card).getByText('왕도').parentElement?.textContent).toBe('왕도 — 3일 · 말, 남')
})

test('the area name opens the parent region card', async () => {
  serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  await nodes('area')
  fireEvent.click(screen.getByRole('button', { name: strings.map.open('북부 왕국') }))
  expect(await screen.findByRole('dialog', { name: '북부 왕국' })).toBeTruthy()
})

test('+ 새 지역 opens a new region drawer', async () => {
  const { calls } = serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  fireEvent.click(await screen.findByRole('button', { name: strings.map.newRegion }))
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')?.body).toEqual({
      type: 'region',
    })
  })
})

test('a locked planning stage reads only: no new region, edit and delete disabled', async () => {
  serve({ locked: true })
  renderBook({ name: 'regions', workId: 'w_1' })
  expect(await screen.findByText(strings.map.hintLocked)).toBeTruthy()
  expect(screen.queryByRole('button', { name: strings.map.newRegion })).toBeNull()
  const [port] = await nodes('region')
  if (!port) throw new Error('no node')
  fireEvent.keyDown(port, { key: 'Enter' })
  await screen.findByRole('dialog', { name: '북부 항구' })
  expect(
    screen.getByRole('button', { name: strings.map.editSource }).hasAttribute('disabled'),
  ).toBe(true)
  expect(screen.getByRole('button', { name: strings.map.delete }).hasAttribute('disabled')).toBe(
    true,
  )
})

test('the contents item and a world book link both open the map', async () => {
  serve()
  const contents = renderBook({ name: 'contents', workId: 'w_1' })
  fireEvent.click(await screen.findByRole('button', { name: '지역' }))
  expect(useNavigation.getState().screen).toEqual({ name: 'regions', workId: 'w_1' })
  contents.unmount()
  renderBook({ name: 'world', workId: 'w_1' })
  fireEvent.click(await screen.findByRole('button', { name: /조수 마법/ }))
  fireEvent.click(await screen.findByRole('button', { name: '북부 항구' }))
  expect(useNavigation.getState().screen).toEqual({
    name: 'regions',
    workId: 'w_1',
    cardId: 'c_port',
  })
})

test('a parent loop in bad data draws plain tokens instead of hanging', async () => {
  serve()
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/relations?kind=parent')
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                relations: [
                  { from_id: 'c_port', to_id: 'c_north', relation: null },
                  { from_id: 'c_north', to_id: 'c_port', relation: null },
                ],
              }),
            ),
          )
        : base(url, init),
    ),
  )
  renderBook({ name: 'regions', workId: 'w_1' })
  // port in north is kept; north in port would close the loop and is dropped.
  expect((await nodes('region')).map((node) => node.dataset.id)).toEqual(['c_port', 'c_capital'])
  expect((await nodes('area')).map((node) => node.dataset.id)).toEqual(['c_north'])
})
