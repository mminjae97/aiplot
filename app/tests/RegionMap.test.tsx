import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, CardOutput, Draft, RegionCard, Work } from '../src/types'
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

const DRAFT: Draft = {
  id: 'dr_1',
  work_id: 'w_1',
  type: 'region',
  card_id: null,
  category: null,
  part_id: null,
  notes: '왕도는 남쪽에 있다.',
  sentences: ['왕도는 남쪽에 있다.'],
  turns: [{ role: 'ai', text: '어떤 곳인가요?' }],
  pinned: [],
  generated: {
    type: 'region',
    name: '왕도',
    data: CAPITAL.data,
    evidence: {},
    ai_guess: [],
  } as CardOutput,
}

function serve(options: { locked?: boolean; moveFails?: boolean } = {}) {
  const calls: Call[] = []
  let regions: Card[] = [PORT, CAPITAL, NORTH]
  // While set, the region list is read but not answered (a slow refetch).
  const hold = { cards: false, release: () => undefined as void }
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
      if (path === '/works/w_1/cards?type=region') {
        if (!hold.cards) return json({ cards: regions })
        return new Promise<Response>((resolve) => {
          hold.release = () => {
            hold.cards = false
            resolve(new Response(JSON.stringify({ cards: regions })))
          }
        })
      }
      if (method === 'PATCH' && path === '/cards/c_port') {
        if (options.moveFails)
          return json({ code: 'INTERNAL_ERROR', message: 'x', hint: null }, 500)
        return json(PORT)
      }
      if (path === '/cards/c_capital/references') return json({ references: [] })
      // A new region's draft with its card already made, ready to save.
      if (method === 'POST' && path === '/works/w_1/drafts') return json(DRAFT, 201)
      if (method === 'GET' && path === '/drafts/dr_1') return json(DRAFT)
      if (method === 'DELETE' && path === '/drafts/dr_1')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (method === 'POST' && path === '/drafts/dr_1/save') return json(CAPITAL)
      if (method === 'DELETE' && path === '/cards/c_capital') {
        regions = regions.filter((card) => card.id !== 'c_capital')
        return json({
          deleted: ['c_capital'],
          restore_until: new Date(Date.now() + 10_000).toISOString(),
        })
      }
      if (method === 'POST' && path === '/cards/c_capital/restore') {
        regions = [PORT, CAPITAL, NORTH]
        return json(CAPITAL)
      }
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
  return { calls, hold }
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

/** Drags a node by (dx, dy) screen pixels, as d3-drag sees a mouse (it reads event.view). */
function drag(node: HTMLElement, dx: number, dy: number) {
  const at = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    })
    Object.defineProperty(event, 'view', { value: window })
    node.dispatchEvent(event)
  }
  at('mousedown', 10, 10)
  at('mousemove', 10 + dx / 2, 10 + dy / 2)
  at('mousemove', 10 + dx, 10 + dy)
  at('mouseup', 10 + dx, 10 + dy)
}

test('dragging a region saves only its place: map_x and map_y', async () => {
  const { calls } = serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  const [port] = await nodes('region')
  if (!port) throw new Error('no node')
  drag(port, 50, 30)
  await waitFor(() => {
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })
  const move = calls.find((c) => c.method === 'PATCH')
  expect(move?.path).toBe('/cards/c_port')
  expect(Object.keys(move?.body as object).sort()).toEqual(['map_x', 'map_y'])
  const { map_x, map_y } = move?.body as { map_x: unknown; map_y: unknown }
  expect(typeof map_x).toBe('number')
  expect(typeof map_y).toBe('number')
  expect(screen.queryByText(strings.map.moveFailed)).toBeNull()
})

test('a locked planning stage cannot move a region', async () => {
  const { calls } = serve({ locked: true })
  renderBook({ name: 'regions', workId: 'w_1' })
  const [port] = await nodes('region')
  if (!port) throw new Error('no node')
  expect(port.classList.contains('draggable')).toBe(false)
  drag(port, 50, 30)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(calls.filter((c) => c.method === 'PATCH')).toEqual([])
})

test('a move that could not be saved says so and draws the map from what is saved', async () => {
  const { calls } = serve({ moveFails: true })
  renderBook({ name: 'regions', workId: 'w_1' })
  const [port] = await nodes('region')
  if (!port) throw new Error('no node')
  const before = port.style.transform
  drag(port, 50, 30)
  expect(await screen.findByText(strings.map.moveFailed)).toBeTruthy()
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  // Drawn again: the token is back where it was laid out.
  await waitFor(() => {
    const again = document.querySelector<HTMLElement>('.react-flow__node[data-id="c_port"]')
    expect(again).not.toBe(port)
    expect(again?.style.transform).toBe(before)
  })
})

test('a deleted region can be brought back; the toast comes before the map is read again', async () => {
  const { calls, hold } = serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  const [, capital] = await nodes('region')
  if (!capital) throw new Error('no node')
  fireEvent.keyDown(capital, { key: 'Enter' })
  await screen.findByRole('dialog', { name: '왕도' })
  fireEvent.click(screen.getByRole('button', { name: strings.map.delete }))
  // The map's next read of the regions is slow: the toast never waits for it.
  hold.cards = true
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: strings.cardDelete.delete,
    }),
  )
  const undo = await screen.findByRole('button', { name: strings.cardDelete.undo })
  expect(hold.cards).toBe(true)
  hold.release()
  await waitFor(() => {
    expect(document.querySelector('.react-flow__node[data-id="c_capital"]')).toBeNull()
  })
  fireEvent.click(undo)
  // Back on the map, highlighted for 0.3s.
  await waitFor(() => {
    expect(
      document.querySelector('.react-flow__node[data-id="c_capital"] .map-node[data-highlight]'),
    ).not.toBeNull()
  })
  await waitFor(() => {
    expect(document.querySelector('.map-node[data-highlight]')).toBeNull()
  })
  expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
    'DELETE /cards/c_capital',
    'POST /cards/c_capital/restore',
  ])
})

test('a saved region is highlighted on the map for 0.3s', async () => {
  const { calls } = serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  await nodes('region')
  fireEvent.click(screen.getByRole('button', { name: strings.map.newRegion }))
  const save = await screen.findByRole('button', { name: strings.preview.save })
  await waitFor(() => {
    expect(save).toHaveProperty('disabled', false)
  })
  fireEvent.click(save)
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/drafts/dr_1/save')).toBe(true)
  })
  await waitFor(() => {
    expect(
      document.querySelector('.react-flow__node[data-id="c_capital"] .map-node[data-highlight]'),
    ).not.toBeNull()
  })
  await waitFor(() => {
    expect(document.querySelector('.map-node[data-highlight]')).toBeNull()
  })
})
