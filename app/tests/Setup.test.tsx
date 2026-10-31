import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AiplotBridge, ServerState } from '../src/api/bridge'
import { useSetupJob } from '../src/api/setup'
import { App } from '../src/App'
import { useNavigation } from '../src/stores/navigation'
import { connectServer, useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { HealthResponse, SetupStatus } from '../src/types'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}
const GB = 1024 ** 3

const pickModel = vi.fn(() => Promise.resolve<string | null>('D:\\models\\base.gguf'))

function bridge(): AiplotBridge {
  return {
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
    dialog: { pickModel, pickFolder: () => Promise.resolve(null) },
  }
}

function health(state: HealthResponse['llama']['state']): HealthResponse {
  return { status: 'ok', llama: { state, profile: 'q5', restarts: 0, message: null }, vram: null }
}

function setupStatus(jobId: string | null): SetupStatus {
  return {
    items: [
      {
        id: 'llama',
        status: 'missing',
        path: 'C:\\data\\llama\\b11982',
        custom: false,
        total_bytes: 0.6 * GB,
        present_bytes: 0,
      },
      {
        id: 'model',
        status: 'partial',
        path: 'C:\\data\\models\\base.gguf',
        custom: false,
        total_bytes: 5.4 * GB,
        present_bytes: 2.7 * GB,
      },
    ],
    remaining_bytes: 3.3 * GB,
    free_bytes: 100 * GB,
    job_id: jobId,
  }
}

type Call = { method: string; path: string; body: unknown }

/** The setup endpoints behind fetch; the job's SSE stream is pushed by the test. */
function serve() {
  const state = {
    health: health('missing_model'),
    jobId: null as string | null,
  }
  const calls: Call[] = []
  let open = false
  let push: (text: string) => void = () => undefined
  let end: () => void = () => undefined
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ method, path, body })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/health') return json(state.health)
      if (path === '/setup') return json(setupStatus(state.jobId))
      if (path === '/works') return json({ works: [] })
      if (path === '/setup/download' || path === '/setup/paths') {
        state.jobId = 'job_1'
        return json({ jobId: 'job_1' }, 202)
      }
      if (path.startsWith('/jobs/job_1/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            open = true
            const encoder = new TextEncoder()
            push = (text) => {
              controller.enqueue(encoder.encode(text))
            }
            end = () => {
              controller.close()
            }
          },
        })
        return Promise.resolve(new Response(stream, { status: 200 }))
      }
      if (path.startsWith('/jobs/job_1/')) return json({ jobId: 'job_1' })
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  const event = async (id: number, type: string, data: unknown) => {
    // Only once the app has opened the job's stream.
    await waitFor(() => {
      expect(open).toBe(true)
    })
    act(() => {
      push(`id: ${String(id)}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    })
  }
  return {
    state,
    calls,
    event,
    finish: () => {
      act(() => {
        end()
      })
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

beforeEach(() => {
  useServer.setState({ state: null })
  useNavigation.setState({ screen: { name: 'library' }, highlight: null })
  useSetupJob.setState({ jobId: null })
  window.aiplot = bridge()
  connectServer()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a missing model opens the first-run screen, which can be put off', async () => {
  serve()
  renderApp()
  expect(await screen.findByRole('heading', { name: strings.setup.title })).toBeTruthy()
  for (const line of [...strings.setup.can, ...strings.setup.limits]) {
    expect(screen.getByText(line)).toBeTruthy()
  }
  expect(await screen.findByText(strings.setup.partial(50))).toBeTruthy()
  expect(screen.getByText(strings.setup.space('3.3GB', '100.0GB'))).toBeTruthy()
  // Part of the model is already there: the button says it continues.
  expect(screen.getByRole('button', { name: strings.setup.resume })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: strings.setup.later }))
  expect(await screen.findByText(strings.library.empty)).toBeTruthy()
})

test('the fixture LLM needs no first run', async () => {
  const { state } = serve()
  state.health = health('fake')
  renderApp()
  expect(await screen.findByText(strings.library.empty)).toBeTruthy()
  expect(screen.queryByRole('heading', { name: strings.setup.title })).toBeNull()
})

test('a download shows progress, keeps going from the library, then loads the model', async () => {
  const { state, calls, event, finish } = serve()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.setup.resume }))
  await event(1, 'progress', { done: 3 * GB, total: 6 * GB, etaSec: 720, step: 'base.gguf' })
  expect(await screen.findByText(strings.setup.downloading(strings.setup.model))).toBeTruthy()
  expect(screen.getByText(strings.setup.eta('약 12분'))).toBeTruthy()
  expect(screen.getByText(/50% · 3.0GB \/ 6.0GB/)).toBeTruthy()
  expect(calls.find((c) => c.path === '/setup/download')?.method).toBe('POST')

  fireEvent.click(screen.getByRole('button', { name: strings.setup.pause }))
  await event(2, 'paused', { reason: 'user' })
  expect(await screen.findByText(strings.setup.paused)).toBeTruthy()
  expect(calls.some((c) => c.path === '/jobs/job_1/pause')).toBe(true)
  await event(3, 'resumed', {})

  // Waiting in the library: the top bar shows the download and leads back.
  fireEvent.click(screen.getByRole('button', { name: strings.setup.background }))
  const chip = await screen.findByRole('button', { name: strings.setup.chip(50) })
  await event(4, 'progress', {
    done: 4.5 * GB,
    total: 6 * GB,
    etaSec: 300,
    step: 'verify base.gguf',
  })
  expect(await screen.findByRole('button', { name: strings.setup.chip(75) })).toBeTruthy()
  fireEvent.click(chip)
  expect(await screen.findByText(strings.setup.verifying(strings.setup.model))).toBeTruthy()

  state.jobId = null
  state.health = health('starting')
  await event(5, 'done', { result: { installed: ['llama', 'model'] } })
  finish()
  expect(await screen.findByText(strings.setup.loading)).toBeTruthy()
  state.health = health('ready')
  expect(await screen.findByText(strings.setup.ready, {}, { timeout: 4000 })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: strings.setup.start }))
  expect(await screen.findByText(strings.library.empty)).toBeTruthy()
})

test('a failed download says why and can start again', async () => {
  const { state, event, finish } = serve()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.setup.resume }))
  state.jobId = null
  await event(1, 'error', { code: 'DOWNLOAD_FAILED', message: 'HTTP 503' })
  finish()
  expect(await screen.findByText(strings.setup.errors.DOWNLOAD_FAILED ?? '')).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.setup.resume })).toBeTruthy()
})

test('files the user has are picked and checked by the server', async () => {
  const { calls } = serve()
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: strings.setup.usePaths }))
  const form = screen.getByRole('form', { name: strings.setup.pathsTitle })
  const [browseModel] = within(form).getAllByRole('button', { name: strings.setup.browse })
  if (!browseModel) throw new Error('no browse button')
  fireEvent.click(browseModel)
  await waitFor(() => {
    expect(within(form).getByLabelText<HTMLInputElement>(strings.setup.modelPath).value).toBe(
      'D:\\models\\base.gguf',
    )
  })
  fireEvent.click(within(form).getByRole('button', { name: strings.setup.check }))
  await waitFor(() => {
    expect(calls.find((c) => c.path === '/setup/paths')).toMatchObject({
      method: 'PUT',
      body: { model_path: 'D:\\models\\base.gguf', llama_dir: null },
    })
  })
})
