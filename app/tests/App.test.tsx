import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AiplotBridge, ServerState } from '../src/api/bridge'
import { App } from '../src/App'
import { connectServer, useServer } from '../src/stores/server'
import { strings } from '../src/strings'

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

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

beforeEach(() => {
  useServer.setState({ state: null })
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

test('ready server lists works with its token', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify({ works: [] }))),
  )
  vi.stubGlobal('fetch', fetch)
  window.aiplot = bridge({ status: 'starting', restarts: 0 })
  connectServer()
  renderApp()
  act(() => {
    for (const listener of listeners) listener(READY)
  })
  expect(await screen.findByText(strings.library.empty)).toBeTruthy()
  const [url, init] = fetch.mock.calls[0] ?? []
  expect(url).toBe('http://127.0.0.1:9100/api/v1/works')
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok')
})

test('library load error offers a retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'x', hint: null }), {
          status: 500,
        }),
      ),
    ),
  )
  window.aiplot = bridge(READY)
  connectServer()
  renderApp()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.library.retry })).toBeTruthy()
})
