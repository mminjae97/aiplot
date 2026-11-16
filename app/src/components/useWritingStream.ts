import { useEffect, useRef, useState } from 'react'
import { FINAL_EVENTS, streamJob } from '../api/sse'
import type { JobProgressEvent } from '../types'
import { NOTHING_STREAMED, type Streamed, streamed } from './writingModel'

// A dropped stream is read again from its last event; a few drops in a row end the reading
// (the job list still tells when the job is over).
const RETRIES = 3
const RETRY_MS = 1000

// Events after which the page reads stored data again; the others only change the stream.
const STORES = new Set(['beat_done', 'beat_checked', 'paused', 'resumed'])

/** A writing job's events (§16), replayed from its start when the page comes back to it: the
 * text streamed so far, its progress, and a call when events changed stored data (a beat
 * stored or checked; `jobChanged` when the job paused, resumed or ended) so the page reads it
 * again. The events of one read (a replay brings many at once) make one call. */
export function useWritingStream(
  jobId: string | null,
  onStored: (jobChanged: boolean) => void,
): { streamed: Streamed; progress: JobProgressEvent | null } {
  const [state, setState] = useState<{
    jobId: string
    streamed: Streamed
    progress: JobProgressEvent | null
  } | null>(null)
  const stored = useRef(onStored)
  useEffect(() => {
    stored.current = onStored
  })

  useEffect(() => {
    if (jobId === null) return
    const controller = new AbortController()
    const stopped = () => controller.signal.aborted
    let after: number | null = null
    let ended = false
    // The stream replays the job from its start: the first event drops what an earlier
    // subscription to the same job left.
    let fresh = true
    let owed: boolean | null = null
    const flush = () => {
      if (owed === null || stopped()) return
      const jobChanged = owed
      owed = null
      stored.current(jobChanged)
    }
    const read = async () => {
      for (let drops = 0; drops <= RETRIES && !ended; drops += 1) {
        if (drops > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
        if (stopped()) return
        const before = after
        try {
          // The last event applied, also when the read breaks off mid-way: a retry goes on
          // after it, never applying an event twice.
          await streamJob(
            jobId,
            (event) => {
              if (event.id !== null) after = event.id
              if (FINAL_EVENTS.has(event.type)) ended = true
              const reset = fresh
              fresh = false
              setState((old) => {
                const base =
                  reset || old?.jobId !== jobId
                    ? { streamed: NOTHING_STREAMED, progress: null }
                    : old
                return {
                  jobId,
                  streamed: streamed(base.streamed, event.type, event.data),
                  progress:
                    event.type === 'progress' ? (event.data as JobProgressEvent) : base.progress,
                }
              })
              const ends = FINAL_EVENTS.has(event.type)
              if (STORES.has(event.type) || ends) {
                const jobChanged = ends || event.type === 'paused' || event.type === 'resumed'
                if (owed === null) setTimeout(flush, 0)
                owed = (owed ?? false) || jobChanged
              }
            },
            { after, signal: controller.signal },
          )
        } catch {
          if (stopped()) return
        }
        // A read that brought events was no drop in a row.
        if (after !== before) drops = 0
      }
    }
    void read()
    return () => {
      controller.abort()
    }
  }, [jobId])

  return state?.jobId === jobId
    ? { streamed: state.streamed, progress: state.progress }
    : { streamed: NOTHING_STREAMED, progress: null }
}
