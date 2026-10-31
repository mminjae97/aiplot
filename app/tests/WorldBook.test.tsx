import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { WorldBookScreen } from '../src/screens/WorldBookScreen'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, WorldCard, Work } from '../src/types'
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

function world(
  id: string,
  name: string,
  category: WorldCard['data']['category'],
  data: Partial<WorldCard['data']> = {},
): WorldCard {
  return {
    id,
    work_id: 'w_1',
    type: 'world',
    name,
    status: 'complete',
    source_notes: '',
    data: {
      category,
      summary: `${name} 요약`,
      details: null,
      rules: [],
      terms: [],
      related: [],
      ...data,
    },
    evidence: {},
    ai_guess: [],
    pinned: [],
    schema_version: 1,
  }
}

const TIDE = world('c_tide', '조수 마법', 'rule', {
  details: '밀물 때 가장 강하다.',
  rules: [
    { rule: '바닷물이 닿는 곳에서만 쓸 수 있다', exception: null },
    { rule: '쓸 때마다 체온을 잃는다', exception: '등대지기 혈통은 대가가 없다' },
  ],
  terms: [{ term: '물때', meaning: '마법이 가장 강한 시각' }],
})
const GUILD = world('c_guild', '등대 길드', 'faction', {
  terms: [{ term: '등불지기', meaning: '길드의 견습생' }],
})
const OATH = world('c_oath', '바다의 맹세', 'rule')
const TEO = { id: 'c_teo', type: 'character', name: '테오' } as unknown as Card

type Call = { method: string; path: string; body: unknown }

function serve(options: { locked?: boolean; references?: boolean } = {}) {
  let worlds: Card[] = [TIDE, GUILD, OATH]
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
      if (path === '/works/w_1/cards?type=world') return json({ cards: worlds })
      if (path === '/works/w_1/cards') return json({ cards: [...worlds, TEO] })
      if (path === '/works/w_1/relations?kind=world')
        return json({
          relations: [
            { from_id: 'c_tide', to_id: 'c_guild', relation: null },
            { from_id: 'c_tide', to_id: 'c_teo', relation: null },
          ],
        })
      if (path === '/cards/c_tide/references')
        return json({
          references: options.references
            ? [{ card_id: 'c_teo', type: 'character', name: '테오', field: 'world' }]
            : [],
        })
      if (method === 'DELETE' && path === '/cards/c_tide') {
        worlds = worlds.filter((card) => card.id !== 'c_tide')
        return json({
          deleted: ['c_tide'],
          restore_until: new Date(Date.now() + 10_000).toISOString(),
        })
      }
      if (method === 'POST' && path === '/cards/c_tide/restore') {
        worlds = [TIDE, ...worlds]
        return json(TIDE)
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

function renderBook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorldBookScreen workId="w_1" />
    </QueryClientProvider>,
  )
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

test('the index lists the open bookmark with page numbers across the whole book', async () => {
  serve()
  renderBook()
  const tabs = screen.getByRole('tablist', { name: strings.worldBook.tabs })
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['규칙·능력', '세력·조직', '역사·사건', '문화·용어', '기타', '용어집'])
  const index = screen.getByRole('tabpanel')
  // Rules come first in the book: 조수 마법 p.1, 바다의 맹세 p.2; the faction page follows.
  await within(index).findByText('조수 마법')
  expect(
    within(index)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['조수 마법1쪽', '바다의 맹세2쪽', strings.worldBook.newEntry])
  fireEvent.click(within(tabs).getByRole('tab', { name: '세력·조직' }))
  expect(within(index).getByRole('button', { name: /등대 길드/ }).textContent).toBe('등대 길드3쪽')
  fireEvent.click(within(tabs).getByRole('tab', { name: '기타' }))
  expect(within(index).getByText(strings.worldBook.empty)).toBeTruthy()
})

test('an entry shows its summary, rules with exceptions, terms and related cards', async () => {
  serve()
  renderBook()
  expect(screen.getByText(strings.worldBook.pick)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: /조수 마법/ }))
  expect(screen.getByRole('heading', { name: '조수 마법' })).toBeTruthy()
  expect(screen.getByText('규칙·능력 · 1쪽')).toBeTruthy()
  expect(screen.getByText('조수 마법 요약')).toBeTruthy()
  expect(screen.getByText('밀물 때 가장 강하다.')).toBeTruthy()
  expect(screen.getByText('쓸 때마다 체온을 잃는다')).toBeTruthy()
  expect(screen.getByText('등대지기 혈통은 대가가 없다')).toBeTruthy()
  expect(screen.getByText('마법이 가장 강한 시각')).toBeTruthy()
  // 함께 보기 from world_relation: a world card links to its entry, the character is named.
  expect(await screen.findByText('테오')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '등대 길드' }))
  expect(screen.getByRole('heading', { name: '등대 길드' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '세력·조직' }).getAttribute('aria-selected')).toBe('true')
})

test('the glossary lists every term in 가나다 order and opens its entry', async () => {
  serve()
  renderBook()
  await screen.findByRole('button', { name: /조수 마법/ })
  fireEvent.click(screen.getByRole('tab', { name: '용어집' }))
  const index = screen.getByRole('tabpanel')
  expect(
    within(index)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['등불지기등대 길드', '물때조수 마법'])
  fireEvent.click(within(index).getByRole('button', { name: /물때/ }))
  expect(screen.getByRole('heading', { name: '조수 마법' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '규칙·능력' }).getAttribute('aria-selected')).toBe('true')
})

test('+ 새 설정 opens the drawer with the open bookmark as the category hint', async () => {
  const { calls } = serve()
  renderBook()
  await screen.findByRole('button', { name: /조수 마법/ })
  fireEvent.click(screen.getByRole('tab', { name: '세력·조직' }))
  fireEvent.click(screen.getByRole('button', { name: strings.worldBook.newEntry }))
  await waitFor(() => {
    expect(calls.find((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')?.body).toEqual({
      type: 'world',
      category: 'faction',
    })
  })
  expect(document.querySelector('main.desk')?.hasAttribute('inert')).toBe(true)
})

test('삭제 lists the referencing cards, deletes, and 되돌리기 brings the entry back', async () => {
  const { calls } = serve({ references: true })
  renderBook()
  fireEvent.click(await screen.findByRole('button', { name: /조수 마법/ }))
  fireEvent.click(screen.getByRole('button', { name: strings.worldBook.delete }))
  const dialog = screen.getByRole('alertdialog')
  expect(await within(dialog).findByText('테오')).toBeTruthy()
  // 취소 has the focus: the red button is never the default.
  expect(document.activeElement?.textContent).toBe(strings.cardDelete.cancel)
  fireEvent.click(within(dialog).getByRole('button', { name: strings.cardDelete.delete }))
  const toast = await screen.findByRole('status')
  expect(toast.textContent).toContain(strings.cardDelete.deleted('조수 마법'))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /조수 마법/ })).toBeNull()
  })
  fireEvent.click(within(toast).getByRole('button', { name: strings.cardDelete.undo }))
  expect(await screen.findByRole('heading', { name: '조수 마법' })).toBeTruthy()
  expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
    'DELETE /cards/c_tide',
    'POST /cards/c_tide/restore',
  ])
})

test('Esc cancels the delete without touching the card', async () => {
  const { calls } = serve()
  renderBook()
  fireEvent.click(await screen.findByRole('button', { name: /조수 마법/ }))
  fireEvent.click(screen.getByRole('button', { name: strings.worldBook.delete }))
  expect(await screen.findByText(strings.cardDelete.unreferenced)).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
})

test('a locked planning stage reads only: no new entry, edit and delete disabled', async () => {
  serve({ locked: true })
  renderBook()
  expect(await screen.findByText(strings.worldBook.locked)).toBeTruthy()
  expect(screen.queryByRole('button', { name: strings.worldBook.newEntry })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /조수 마법/ }))
  expect(
    screen.getByRole('button', { name: strings.worldBook.editSource }).hasAttribute('disabled'),
  ).toBe(true)
  expect(
    screen.getByRole('button', { name: strings.worldBook.delete }).hasAttribute('disabled'),
  ).toBe(true)
})
