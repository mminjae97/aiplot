import { useEffect, useState } from 'react'
import { streamJob } from '../api/sse'
import type { JobProgressEvent } from '../types'

/** The latest progress report of a job (§16), replayed from its start when the screen comes
 * back to it. A dropped stream only stops the numbers: whether the job ended is read from the
 * work's job list. */
export function useJobProgress(jobId: string | null): JobProgressEvent | null {
  const [latest, setLatest] = useState<{ jobId: string; progress: JobProgressEvent } | null>(null)

  useEffect(() => {
    if (jobId === null) return
    const controller = new AbortController()
    streamJob(
      jobId,
      (event) => {
        if (event.type === 'progress') {
          setLatest({ jobId, progress: event.data as JobProgressEvent })
        }
      },
      { signal: controller.signal },
    ).catch(() => undefined)
    return () => {
      controller.abort()
    }
  }, [jobId])

  return latest?.jobId === jobId ? latest.progress : null
}
