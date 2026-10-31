import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { CharacterDexScreen } from '../src/screens/CharacterDexScreen'
import { ContentsPage } from '../src/screens/ContentsPage'
import { WorldBookScreen } from '../src/screens/WorldBookScreen'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, CharacterCard, Work } from '../src/types'
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

function character(
  id: string,
  name: string,
  data: Partial<CharacterCard['data']> = {},
  status: CharacterCard['status'] = 'complete',
): CharacterCard {
  return {
    id,
    work_id: 'w_1',
    type: 'character',
    name,
    status,
    source_notes: '',
    data: {
      theme: null,
      personality: { traits: [], behaviors: [] },
      speech: { description: null, examples: [] },
      appearance: { summary: null, details: null },
      relations: [],
      origin_region_id: null,
      ...data,
    },
    evidence: {},
    ai_guess: [],
    pinned: [],
    schema_version: 1,
  }
}

const TEO = character('c_teo', '테오', {
  theme: '잃어버린 가족을 찾는 귀환자',
  personality: {
    traits: ['과묵함', '집요함'],
    behaviors: [{ situation: '위협을 받을 때', action: '먼저 칼을 뽑는다' }],
  },
  speech: {
    description: '짧고 건조한 반말',
    examples: ['됐어.', '따라와.', '그건 내 일이 아니야.'],
  },
  appearance: { summary: '왼손에 흉터가 있는 20대 남성', details: null },
  // What the data says is not what the screen shows: relations come from char_relation.
  relations: [{ target_id: 'c_ghost', relation: '유령' }],
  // Likewise the origin: the character table's column says 북부 항구.
  origin_region_id: null,
})
const MIRA = character('c_mira', '미라', { theme: '항구의 의사' }, 'incomplete')
const PORT = { id: 'c_port', type: 'region', name: '북부 항구' } as unknown as Card
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
  let characters: Card[] = [TEO, MIRA]
  const calls: Call[] = []
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
      if (path === '/works/w_1/cards?type=character') return json({ cards: characters })
      if (path === '/works/w_1/cards?type=world') return json({ cards: [TIDE] })
      if (path === '/works/w_1/cards') return json({ cards: [...characters, PORT, TIDE] })
      if (path === '/works/w_1/relations?kind=character')
        return json({ relations: [{ from_id: 'c_teo', to_id: 'c_mira', relation: '소꿉친구' }] })
      if (path === '/works/w_1/relations?kind=origin')
        return json({ relations: [{ from_id: 'c_teo', to_id: 'c_port', relation: null }] })
      if (path === '/works/w_1/relations?kind=world')
        return json({ relations: [{ from_id: 'c_tide', to_id: 'c_teo', relation: null }] })
      if (path === '/cards/c_teo/references') return json({ references: [] })
      if (method === 'DELETE' && path === '/cards/c_teo') {
        characters = characters.filter((card) => card.id !== 'c_teo')
        return json({
          deleted: ['c_teo'],
          restore_until: new Date(Date.now() + 10_000).toISOString(),
        })
      }
      if (method === 'POST' && path === '/cards/c_teo/restore') {
        characters = [TEO, ...characters]
        return json(TEO)
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
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

test('the dex lays out a card per character, incomplete ones marked in words, + last', async () => {
  serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  const grid = (await screen.findByRole('button', { name: strings.dex.flip('테오') })).closest('ul')
  if (!grid) throw new Error('no grid')
  expect(
    within(grid)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['테테오', `미미라${strings.dex.incomplete}`, `+${strings.dex.newCard}`])
})

test('a picked card turns to every field; relations from the relation table', async () => {
  serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  const teo = await screen.findByRole('button', { name: strings.dex.flip('테오') })
  teo.focus()
  fireEvent.click(teo)
  const card = screen.getByRole('dialog', { name: '테오' })
  for (const text of [
    '잃어버린 가족을 찾는 귀환자',
    '과묵함',
    '짧고 건조한 반말',
    '“그건 내 일이 아니야.”',
    '왼손에 흉터가 있는 20대 남성',
  ])
    expect(within(card).getByText(text)).toBeTruthy()
  expect(await within(card).findByText('북부 항구')).toBeTruthy()
  expect(within(card).getByText('위협을 받을 때').parentElement?.textContent).toBe(
    '위협을 받을 때 → 먼저 칼을 뽑는다',
  )
  expect(await within(card).findByText('미라')).toBeTruthy()
  expect(within(card).getByText('— 소꿉친구')).toBeTruthy()
  expect(within(card).queryByText('유령')).toBeNull()
  // The close button has the focus; Esc puts the card down and the focus goes back.
  expect(document.activeElement?.textContent).toBe(strings.dex.close)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(teo)
})

test('an incomplete card shows its empty required fields as undecided', async () => {
  serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.flip('미라') }))
  const card = screen.getByRole('dialog', { name: '미라' })
  expect(within(card).getByText(`· ${strings.dex.incomplete}`)).toBeTruthy()
  // traits, speech, examples, appearance: four required fields still open.
  expect(within(card).getAllByText(strings.preview.undecided)).toHaveLength(4)
})

test('+ opens a new character drawer', async () => {
  const { calls } = serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.newCard }))
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')?.body).toEqual({
      type: 'character',
    })
  })
})

test('원문 수정 puts the card down and opens its notes', async () => {
  const { calls } = serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.flip('테오') }))
  fireEvent.click(screen.getByRole('button', { name: strings.dex.editSource }))
  expect(screen.queryByRole('dialog', { name: '테오' })).toBeNull()
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')?.body).toEqual({
      type: 'character',
      card_id: 'c_teo',
    })
  })
})

test('삭제 sits over the card: Esc closes only the dialog; deleting puts the card away', async () => {
  const { calls } = serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.flip('테오') }))
  fireEvent.click(screen.getByRole('button', { name: strings.dex.delete }))
  expect(await screen.findByRole('alertdialog')).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByRole('dialog', { name: '테오' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: strings.dex.delete }))
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: strings.cardDelete.delete,
    }),
  )
  const undo = await screen.findByRole('button', { name: strings.cardDelete.undo })
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: strings.dex.flip('테오') })).toBeNull()
  })
  fireEvent.click(undo)
  const back = await screen.findByRole('button', { name: strings.dex.flip('테오') })
  expect(back.hasAttribute('data-highlight')).toBe(true)
  expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
    'DELETE /cards/c_teo',
    'POST /cards/c_teo/restore',
  ])
})

test('a locked planning stage reads only: no + card, edit and delete disabled', async () => {
  serve({ locked: true })
  renderWith(<CharacterDexScreen workId="w_1" />)
  expect(await screen.findByText(strings.dex.locked)).toBeTruthy()
  expect(screen.queryByRole('button', { name: strings.dex.newCard })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: strings.dex.flip('테오') }))
  expect(
    screen.getByRole('button', { name: strings.dex.editSource }).hasAttribute('disabled'),
  ).toBe(true)
  expect(screen.getByRole('button', { name: strings.dex.delete }).hasAttribute('disabled')).toBe(
    true,
  )
})

test('the contents item and a world book link both open the dex', async () => {
  serve()
  renderWith(<ContentsPage workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: '캐릭터' }))
  expect(useNavigation.getState().screen).toEqual({ name: 'characters', workId: 'w_1' })
})

test('함께 보기 opens the dex with that character picked up', async () => {
  serve()
  renderWith(<WorldBookScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: /조수 마법/ }))
  fireEvent.click(await screen.findByRole('button', { name: '테오' }))
  expect(useNavigation.getState().screen).toEqual({
    name: 'characters',
    workId: 'w_1',
    cardId: 'c_teo',
  })
  renderWith(<CharacterDexScreen workId="w_1" cardId="c_teo" />)
  expect(await screen.findByRole('dialog', { name: '테오' })).toBeTruthy()
})

test('a link to a card that is not in the dex picks nothing up', async () => {
  serve()
  renderWith(<CharacterDexScreen workId="w_1" cardId="c_gone" />)
  await screen.findByRole('button', { name: strings.dex.flip('테오') })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(
    screen.getByRole('button', { name: strings.contents.toContents }).hasAttribute('disabled'),
  ).toBe(false)
})

test('the highlight after a restore lasts 0.3s', async () => {
  serve()
  renderWith(<CharacterDexScreen workId="w_1" />)
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.flip('테오') }))
  fireEvent.click(screen.getByRole('button', { name: strings.dex.delete }))
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: strings.cardDelete.delete,
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: strings.cardDelete.undo }))
  const teo = await screen.findByRole('button', { name: strings.dex.flip('테오') })
  expect(teo.hasAttribute('data-highlight')).toBe(true)
  await waitFor(() => {
    expect(teo.hasAttribute('data-highlight')).toBe(false)
  })
})

test('도감 | 관계도: the last view comes back next time', async () => {
  serve()
  localStorage.removeItem('aiplot.dex.view')
  const first = renderWith(<CharacterDexScreen workId="w_1" />)
  await screen.findByRole('button', { name: strings.dex.flip('테오') })
  const cardsTab = screen.getByRole('tab', { name: strings.dex.cardsTab })
  expect(cardsTab.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(cardsTab, { key: 'ArrowRight' })
  expect(
    screen.getByRole('tab', { name: strings.dex.graphTab }).getAttribute('aria-selected'),
  ).toBe('true')
  expect(document.activeElement?.textContent).toBe(strings.dex.graphTab)
  expect(screen.getByText(strings.dex.graphHint)).toBeTruthy()
  first.unmount()
  renderWith(<CharacterDexScreen workId="w_1" />)
  expect(
    screen.getByRole('tab', { name: strings.dex.graphTab }).getAttribute('aria-selected'),
  ).toBe('true')
  localStorage.removeItem('aiplot.dex.view')
})

// Lines and labels need real layout (React Flow measures the nodes); they are checked by
// tests/relationLayout.test.ts and by eye in the app.
test('관계도: a node per character; Enter on a node opens its card', async () => {
  serve()
  localStorage.setItem('aiplot.dex.view', 'graph')
  renderWith(<CharacterDexScreen workId="w_1" />)
  await waitFor(() => {
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(2)
  })
  const nodes = document.querySelectorAll<HTMLElement>('.react-flow__node')
  expect([...nodes].map((node) => node.dataset.id)).toEqual(['c_teo', 'c_mira'])
  const teo = [...nodes].find((node) => node.dataset.id === 'c_teo')
  if (!teo) throw new Error('no node')
  fireEvent.keyDown(teo, { key: 'Enter' })
  expect(await screen.findByRole('dialog', { name: '테오' })).toBeTruthy()
  localStorage.removeItem('aiplot.dex.view')
})

test('관계도: after 원문 수정 the focus comes back to the node', async () => {
  serve()
  localStorage.setItem('aiplot.dex.view', 'graph')
  renderWith(<CharacterDexScreen workId="w_1" />)
  await waitFor(() => {
    expect(document.querySelector('.react-flow__node[data-id="c_teo"]')).not.toBeNull()
  })
  const teo = document.querySelector<HTMLElement>('.react-flow__node[data-id="c_teo"]')
  if (!teo) throw new Error('no node')
  fireEvent.keyDown(teo, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('button', { name: strings.dex.editSource }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  await waitFor(() => {
    expect(document.activeElement).toBe(
      document.querySelector('.react-flow__node[data-id="c_teo"]'),
    )
  })
  localStorage.removeItem('aiplot.dex.view')
})
