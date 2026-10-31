import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AiplotBridge, ServerState } from '../src/api/bridge'
import { App } from '../src/App'
import { useNavigation } from '../src/stores/navigation'
import { connectServer, useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Work } from '../src/types'
import { FAKE_HEALTH, NO_DIALOGS, SETUP_IDLE } from './serverFixtures'

let listeners: ((state: ServerState) => void)[] = []
const retry = vi.fn(() => Promise.resolve())
let maximizedListeners: ((maximized: boolean) => void)[] = []
const windowCalls = {
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}

function bridge(initial: ServerState): AiplotBridge {
  return {
    server: {
      get: () => Promise.resolve(initial),
      retry,
      onChange: (listener) => {
        listeners.push(listener)
        return () => {
          listeners = listeners.filter((l) => l !== listener)
        }
      },
    },
    dialog: NO_DIALOGS,
    window: {
      ...windowCalls,
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: (listener) => {
        maximizedListeners.push(listener)
        return () => {
          maximizedListeners = maximizedListeners.filter((l) => l !== listener)
        }
      },
    },
  }
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

const READY: Extract<ServerState, { status: 'ready' }> = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

function work(id: string, title: string, updated: string): Work {
  return {
    id,
    title,
    stage: 1,
    locked_stage: 0,
    last_item: null,
    color: null,
    cover_id: null,
    updated_at: updated,
  }
}

type Call = { method: string; path: string; body: unknown; auth: string | null }

/** A tiny in-memory works API behind fetch. */
function serve(initial: Work[], overrides: Partial<Record<string, Response>> = {}) {
  const works = [...initial]
  const calls: Call[] = []
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const path = url.replace(`${READY.baseUrl}/api/v1`, '')
    const method = init.method ?? 'GET'
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ method, path, body, auth: new Headers(init.headers).get('Authorization') })
    const override = overrides[`${method} ${path}`]
    if (override) return Promise.resolve(override)
    const json = (data: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(data), { status }))
    if (path === '/health') return json(FAKE_HEALTH)
    if (path === '/setup') return json(SETUP_IDLE)
    if (method === 'GET' && path === '/works') return json({ works })
    if (method === 'POST' && path === '/works') {
      const { title } = body as { title: string }
      const created = work(`w_${String(works.length + 1)}`, title, '2026-10-30T10:00:00.000Z')
      works.unshift(created)
      return json(created, 201)
    }
    const found = works.find((w) => `/works/${w.id}` === path)
    return found ? json(found) : json({ code: 'WORK_NOT_FOUND', message: 'no', hint: null }, 404)
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

beforeEach(() => {
  useServer.setState({ state: null })
  useNavigation.setState({ screen: { name: 'library' }, highlight: null })
  listeners = []
  maximizedListeners = []
  retry.mockClear()
  for (const call of Object.values(windowCalls)) call.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('shows the starting screen until the server is ready', async () => {
  window.aiplot = bridge({ status: 'starting', restarts: 0 })
  connectServer()
  renderApp()
  expect(await screen.findByRole('status')).toHaveProperty('textContent', strings.server.starting)
})

test('failed server shows the cause and retries', async () => {
  window.aiplot = bridge({ status: 'error', reason: 'failed', restarts: 3 })
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.server.retry }))
  expect(retry).toHaveBeenCalledOnce()
  expect(screen.getByText(strings.server.failed)).toBeTruthy()
})

test('missing server offers no retry', async () => {
  window.aiplot = bridge({ status: 'error', reason: 'missing', restarts: 0 })
  connectServer()
  renderApp()
  expect(await screen.findByText(strings.server.missing)).toBeTruthy()
  expect(screen.queryByRole('button', { name: strings.server.retry })).toBeNull()
})

test('empty library invites the first book once the server is ready', async () => {
  const { calls } = serve([])
  window.aiplot = bridge({ status: 'starting', restarts: 0 })
  connectServer()
  renderApp()
  act(() => {
    for (const listener of listeners) listener(READY)
  })
  expect(await screen.findByText(strings.library.empty)).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.library.newBook })).toBeTruthy()
  expect(calls.find((c) => c.path === '/works')).toMatchObject({
    method: 'GET',
    auth: 'Bearer tok',
  })
})

test('books stand newest first; stage and date are read, not shown', async () => {
  serve([
    work('w_b', '둘째 책', '2026-10-30T09:00:00.000Z'),
    work('w_a', '첫 책', '2026-10-29T09:00:00.000Z'),
  ])
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  await screen.findByText('둘째 책', { selector: '.book-title' })
  const titles = [...document.querySelectorAll('.book-title')].map((t) => t.textContent)
  expect(titles).toEqual(['둘째 책', '첫 책'])
  expect(screen.queryByText(strings.library.empty)).toBeNull()
  expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  const book = screen.getByRole('button', { name: '둘째 책' })
  expect(book.getAttribute('aria-describedby')).toBe('about-w_b')
  expect(document.getElementById('about-w_b')?.textContent).toContain(
    strings.library.stageOf(strings.stage[1]),
  )
})

test('new book takes a title and opens its contents', async () => {
  const { calls } = serve([])
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.library.newBook }))
  const create = screen.getByRole('button', { name: strings.newBook.create })
  expect(create).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText(strings.newBook.label), {
    target: { value: '안개의 항구' },
  })
  fireEvent.click(create)
  expect(await screen.findByRole('heading', { name: strings.contents.heading })).toBeTruthy()
  expect(screen.getAllByText('안개의 항구').length).toBeGreaterThan(0)
  expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: '안개의 항구' })
  for (const item of strings.contents.groups.flatMap((g) => g.items)) {
    expect(screen.getAllByText(item).length).toBeGreaterThan(0)
  }
  // Later stages say so in words, not only by a fainter colour.
  expect(screen.getAllByText(strings.contents.laterStage)).toHaveLength(3)

  fireEvent.click(screen.getByRole('button', { name: strings.contents.back }))
  expect(await screen.findByRole('button', { name: /안개의 항구/ })).toBeTruthy()
  // The book just made gets its short lift on the shelf.
  expect(document.querySelector('.book[data-highlighted] .book-title')?.textContent).toBe(
    '안개의 항구',
  )
})

test('new book keeps focus inside and gives it back to the + book', async () => {
  serve([])
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  const plus = await screen.findByRole('button', { name: strings.library.newBook })
  plus.focus()
  fireEvent.click(plus)
  expect(document.activeElement).toBe(screen.getByLabelText(strings.newBook.label))
  // The shelf behind the dialog is inert, so Tab cannot reach it.
  expect(plus.closest('[inert]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: strings.newBook.cancel }))
  await waitFor(() => {
    expect(document.activeElement).toBe(plus)
  })
  expect(plus.closest('[inert]')).toBeNull()
})

test('closing the dialog before the server answers stays on the shelf', async () => {
  let answer: (response: Response) => void = () => undefined
  let posts = 0
  serve([])
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      if (init.method !== 'POST') return base(url, init)
      posts += 1
      return new Promise<Response>((resolve) => {
        answer = resolve
      })
    }),
  )
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.library.newBook }))
  fireEvent.change(screen.getByLabelText(strings.newBook.label), { target: { value: '책' } })
  fireEvent.click(screen.getByRole('button', { name: strings.newBook.create }))
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  answer(
    new Response(JSON.stringify(work('w_9', '책', '2026-10-30T10:00:00.000Z')), { status: 201 }),
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('heading', { name: strings.contents.heading })).toBeNull()
  expect(posts).toBe(1)
})

test('new book explains server title errors and closes with Escape', async () => {
  serve([], {
    'POST /works': new Response(
      JSON.stringify({ code: 'TITLE_EMPTY', message: 'the title is blank', hint: null }),
      { status: 422 },
    ),
  })
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.library.newBook }))
  fireEvent.change(screen.getByLabelText(strings.newBook.label), { target: { value: '책' } })
  fireEvent.click(screen.getByRole('button', { name: strings.newBook.create }))
  expect(await screen.findByText(strings.newBook.titleEmpty)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(strings.newBook.label), {
    target: { value: '가'.repeat(101) },
  })
  expect(screen.getByText(strings.newBook.titleTooLong)).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

test('server says the title is too long', async () => {
  serve([], {
    'POST /works': new Response(
      JSON.stringify({ code: 'TITLE_TOO_LONG', message: 'over 100', hint: null }),
      { status: 422 },
    ),
  })
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.library.newBook }))
  fireEvent.change(screen.getByLabelText(strings.newBook.label), { target: { value: '책' } })
  fireEvent.click(screen.getByRole('button', { name: strings.newBook.create }))
  expect(await screen.findByText(strings.newBook.titleTooLong)).toBeTruthy()
})

test('the top bar is the title bar: window buttons on every screen', async () => {
  window.aiplot = bridge({ status: 'starting', restarts: 0 })
  connectServer()
  renderApp()
  // Even before the server is up the window can be moved, minimized and closed.
  fireEvent.click(await screen.findByRole('button', { name: strings.window.minimize }))
  fireEvent.click(screen.getByRole('button', { name: strings.window.maximize }))
  fireEvent.click(screen.getByRole('button', { name: strings.window.close }))
  expect(windowCalls.minimize).toHaveBeenCalledOnce()
  expect(windowCalls.toggleMaximize).toHaveBeenCalledOnce()
  expect(windowCalls.close).toHaveBeenCalledOnce()
  // The middle button follows the window's state.
  act(() => {
    for (const listener of maximizedListeners) listener(true)
  })
  expect(screen.getByRole('button', { name: strings.window.restore })).toBeTruthy()
  // Never Tab stops, like native caption buttons.
  for (const name of [strings.window.minimize, strings.window.restore, strings.window.close]) {
    expect(screen.getByRole('button', { name }).tabIndex).toBe(-1)
  }
})

test('window buttons stay usable while the new-book dialog is open', async () => {
  serve([])
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.library.newBook }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  const close = screen.getByRole('button', { name: strings.window.close })
  expect(close.closest('[inert]')).toBeNull()
  fireEvent.click(close)
  expect(windowCalls.close).toHaveBeenCalledOnce()
})

test('library load error offers a retry', async () => {
  serve([], {
    'GET /works': new Response(
      JSON.stringify({ code: 'INTERNAL_ERROR', message: 'x', hint: null }),
      { status: 500 },
    ),
  })
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.library.retry })).toBeTruthy()
})
