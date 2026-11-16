import { useEffect, useRef, useState } from 'react'
import { FINAL_EVENTS, streamJob } from '../api/sse'
import type { JobProgressEvent } from '../types'
import { NOTHING_STREAMED, type Streamed, streamed } from './writingModel'

// A dropped stream is read again from its last event, a few times at most.
const RETRIES = 3
const RETRY_MS = 1000

/** A writing job's events (§16), replayed from its start when the page comes back to it: the
 * text streamed so far, its progress, and a call for each event that changes stored data
 * (beat_done, beat_checked, the job's end) so the page reads it again. */
export function useWritingStream(
  jobId: string | null,
  onStored: (type: string) => void,
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
    const read = async () => {
      for (let attempt = 0; attempt <= RETRIES && !ended; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
        if (stopped()) return
        try {
          after = await streamJob(
            jobId,
            (event) => {
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
              if (
                event.type === 'beat_done' ||
                event.type === 'beat_checked' ||
                FINAL_EVENTS.has(event.type)
              ) {
                stored.current(event.type)
              }
            },
            { after, signal: controller.signal },
          )
        } catch {
          if (stopped()) return
        }
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
