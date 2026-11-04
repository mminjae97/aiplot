import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { type JobLive, follow, jobKey, useSetupJob, useSetupWatcher, wait } from '../src/api/setup'
import { useServer } from '../src/stores/server'
import type { SetupStatus } from '../src/types'

beforeEach(() => {
  useServer.setState({
    state: { status: 'ready', baseUrl: 'http://127.0.0.1:9100', token: 'tok', restarts: 0 },
  })
  useSetupJob.setState({ jobId: null, seen: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const error503 = () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: 'HTTP_503', message: 'busy', hint: null }), {
      status: 503,
    }),
  )

test('a stream that breaks mid-way resumes after its last event, backing off up to 10 s', async () => {
  vi.useFakeTimers()
  const calls: { url: string; at: number }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push({ url, at: Date.now() })
      if (calls.length > 1) return error503()
      // One whole event, then the connection breaks.
      let sent = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) {
            controller.error(new Error('connection reset'))
            return
          }
          sent = true
          controller.enqueue(
            new TextEncoder().encode(
              'id: 7\nevent: progress\ndata: {"done":1,"total":2,"etaSec":null,"step":null}\n\n',
            ),
          )
        },
      })
      return Promise.resolve(new Response(stream))
    }),
  )
  const client = new QueryClient()
  const controller = new AbortController()
  const following = follow(client, 'job_1', controller.signal)
  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toHaveLength(1)
  expect(client.getQueryData<JobLive>(jobKey('job_1'))?.progress?.done).toBe(1)
  await vi.advanceTimersByTimeAsync(60_000)
  // Every reconnect starts after the event already handled, never from the start.
  expect(calls[1]?.url).toContain('/jobs/job_1/events?after=7')
  expect(calls.slice(1).every((c) => c.url.endsWith('?after=7'))).toBe(true)
  const gaps = calls.slice(1, 7).map((c, i) => c.at - (calls[i]?.at ?? 0))
  expect(gaps).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000])
  controller.abort()
  await vi.advanceTimersByTimeAsync(0)
  await following
})

test('a wait leaves no abort listener behind', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const waited = wait(1000, controller.signal)
  await vi.advanceTimersByTimeAsync(1000)
  await waited
  expect(add).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1])
})

function Watcher() {
  useSetupWatcher()
  return null
}

test('a cached /setup naming a job that has ended is not followed again', async () => {
  const stale: SetupStatus = {
    items: [],
    remaining_bytes: 0,
    free_bytes: 0,
    job_id: 'job_A',
  }
  // The new job's stream stays open; /setup still names the old one.
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      asked.push(url)
      if (url.endsWith('/setup')) return Promise.resolve(new Response(JSON.stringify(stale)))
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>()))
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['setup'], stale)
  client.setQueryData<JobLive>(jobKey('job_A'), {
    progress: null,
    paused: false,
    final: { type: 'done' },
  })
  useSetupJob.setState({ jobId: 'job_B' })
  render(
    <QueryClientProvider client={client}>
      <Watcher />
    </QueryClientProvider>,
  )
  await waitFor(() => {
    expect(asked.some((url) => url.endsWith('/setup'))).toBe(true)
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(useSetupJob.getState().jobId).toBe('job_B')
})

test('a job named by /setup whose end is unknown is followed', async () => {
  const status: SetupStatus = { items: [], remaining_bytes: 0, free_bytes: 0, job_id: 'job_A' }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/setup')) return Promise.resolve(new Response(JSON.stringify(status)))
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>()))
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Watcher />
    </QueryClientProvider>,
  )
  await waitFor(() => {
    expect(useSetupJob.getState().jobId).toBe('job_A')
  })
})
