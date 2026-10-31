import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { HealthResponse, JobProgressEvent } from '../types'
import { ApiRequestError, api } from './client'
import { FINAL_EVENTS, type JobEvent, streamJob } from './sse'

/** What the app knows of a running job from its event stream (§16). */
export type JobLive = {
  progress: JobProgressEvent | null
  paused: boolean
  final:
    | { type: 'done' }
    | { type: 'cancelled' }
    | { type: 'error'; code: string; message: string }
    // The server no longer knows the job (it restarted): nothing to show.
    | { type: 'gone' }
    | null
}

const EMPTY: JobLive = { progress: null, paused: false, final: null }

export const jobKey = (jobId: string) => ['job', jobId]

/** The setup job the first-run screen follows (UI pointer; its data lives in the query cache).
 * seen: a job whose ending S0-1 has shown, so the top-bar chip no longer reports it. */
export const useSetupJob = create<{
  jobId: string | null
  seen: string | null
  follow: (jobId: string) => void
  acknowledge: (jobId: string) => void
}>((set) => ({
  jobId: null,
  seen: null,
  follow: (jobId) => {
    set({ jobId })
  },
  acknowledge: (jobId) => {
    set({ seen: jobId })
  },
}))

// llama.cpp or the base model is not there yet, or llama-server gave up: S0-1 (§12, §13).
const SETUP_STATES = new Set(['missing_binary', 'missing_model', 'error'])

export function needsSetup(health: HealthResponse): boolean {
  return SETUP_STATES.has(health.llama.state)
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    // The model loads in the background after its files arrive.
    refetchInterval: (query) => {
      const state = query.state.data?.llama.state
      // stopped: between processes (boot, or new files swapped in); starting follows.
      return state === 'starting' || state === 'stopped' ? 2000 : false
    },
  })
}

export function useSetupStatus() {
  return useQuery({ queryKey: ['setup'], queryFn: api.setup })
}

/** Live state of a job, kept up by useSetupWatcher. */
export function useJobLive(jobId: string | null): JobLive | null {
  const live = useQuery({
    queryKey: jobKey(jobId ?? ''),
    queryFn: () => EMPTY,
    enabled: false,
    staleTime: Infinity,
  })
  return jobId === null ? null : (live.data ?? EMPTY)
}

function apply(live: JobLive, event: JobEvent): JobLive {
  const data = event.data as Record<string, unknown>
  switch (event.type) {
    case 'progress':
      return { ...live, progress: event.data as JobProgressEvent }
    case 'paused':
      return { ...live, paused: true }
    case 'resumed':
      return { ...live, paused: false }
    case 'done':
      return { ...live, paused: false, final: { type: 'done' } }
    case 'cancelled':
      return { ...live, paused: false, final: { type: 'cancelled' } }
    case 'error':
      return {
        ...live,
        paused: false,
        final: { type: 'error', code: String(data.code), message: String(data.message) },
      }
    default:
      return live
  }
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

async function follow(client: QueryClient, jobId: string, signal: AbortSignal): Promise<void> {
  let after: number | null = null
  // Set from the event callback, so read through a call (no stale narrowing).
  const seen = { final: false }
  const ended = () => seen.final || signal.aborted
  const update = (event: JobEvent) => {
    client.setQueryData<JobLive>(jobKey(jobId), (old) => apply(old ?? EMPTY, event))
    if (FINAL_EVENTS.has(event.type)) seen.final = true
  }
  while (!ended()) {
    try {
      after = await streamJob(jobId, update, { after, signal })
    } catch (error) {
      // The job is gone (finished long ago, or a restarted server): stop following.
      if (error instanceof ApiRequestError && error.status === 404) {
        client.setQueryData<JobLive>(jobKey(jobId), (old) => ({
          ...(old ?? EMPTY),
          final: old?.final ?? { type: 'gone' },
        }))
        break
      }
    }
    // The stream dropped (server busy or restarting): pick it up again after the last event.
    if (!ended()) await wait(1000, signal)
  }
  if (signal.aborted) return
  await Promise.all([
    client.invalidateQueries({ queryKey: ['setup'] }),
    client.invalidateQueries({ queryKey: ['health'] }),
  ])
}

/** Follows the running setup job wherever the user is, so the library can show its progress
 * and the first-run screen picks it up again (§5 background option). */
export function useSetupWatcher(): void {
  const client = useQueryClient()
  const setup = useSetupStatus()
  const jobId = useSetupJob((store) => store.jobId)
  const followJob = useSetupJob((store) => store.follow)
  const running = setup.data?.job_id ?? null

  useEffect(() => {
    // A job started before this screen opened (or by another click) is followed too.
    if (running !== null && running !== jobId) followJob(running)
  }, [running, jobId, followJob])

  useEffect(() => {
    if (jobId === null) return
    const controller = new AbortController()
    void follow(client, jobId, controller.signal)
    return () => {
      controller.abort()
    }
  }, [client, jobId])
}
