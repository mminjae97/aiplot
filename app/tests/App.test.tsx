import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AiplotBridge, ServerState } from '../src/api/bridge'
import { App } from '../src/App'
import { useNavigation } from '../src/stores/navigation'
import { connectServer, useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Work } from '../src/types'

let listeners: ((state: ServerState) => void)[] = []
const retry = vi.fn(() => Promise.resolve())

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
  retry.mockClear()
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
  expect(screen.queryByRole('button')).toBeNull()
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
  expect(calls[0]).toMatchObject({ method: 'GET', path: '/works', auth: 'Bearer tok' })
})

test('books stand newest first with their info slip', async () => {
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
  const [slip] = screen.getAllByRole('tooltip', { hidden: true })
  expect(slip?.textContent).toContain(strings.library.stageOf(strings.stage[1]))
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

  fireEvent.click(screen.getByRole('button', { name: strings.contents.back }))
  expect(await screen.findByRole('button', { name: /안개의 항구/ })).toBeTruthy()
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
