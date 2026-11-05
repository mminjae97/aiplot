import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { draftKey } from '../api/drafts'
import { streamJob } from '../api/sse'
import { strings } from '../strings'
import type { DraftGenerate } from '../types'
import { errorText } from './drawerErrors'

/** The draft's card generation job (§8: waited for in the drawer, elapsed seconds shown, can
 * be cancelled). The stream stops when the drawer goes; deleting the draft stops the job. */
export function useCardGeneration(draftId: string | null) {
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState<{ jobId: string | null; seconds: number } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  // The notes the shown card was generated from: once they change, the card is stale.
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null)
  const stream = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      stream.current?.abort()
    },
    [],
  )

  const isGenerating = generating !== null
  useEffect(() => {
    if (!isGenerating) return
    // Elapsed seconds for the long-wait note (§5).
    const timer = window.setInterval(() => {
      setGenerating((old) => old && { ...old, seconds: old.seconds + 1 })
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [isGenerating])

  /** True when a card came back (a failed or cancelled one changes nothing). */
  const run = async (body: DraftGenerate): Promise<boolean> => {
    if (draftId === null) return false
    const controller = new AbortController()
    stream.current = controller
    const alive = () => !controller.signal.aborted
    setError(null)
    setGenerating({ jobId: null, seconds: 0 })
    try {
      const accepted = await api.generateCard(draftId, body)
      if (!alive()) return false
      setGenerating((old) => old && { ...old, jobId: accepted.jobId })
      // Set from the event callback, so kept in an object.
      const outcome = { done: false, failure: null as string | null }
      await streamJob(
        accepted.jobId,
        (event) => {
          if (event.type === 'done') outcome.done = true
          if (event.type === 'error') outcome.failure = (event.data as { code: string }).code
          if (event.type === 'cancelled') outcome.failure = 'CANCELLED'
        },
        { signal: controller.signal },
      )
      if (!alive()) return false
      const failure = outcome.failure
      if (failure !== null && failure !== 'CANCELLED') setError(errorText(failure))
      // The stream ended without a result (dropped, or a restarted server).
      else if (!outcome.done && failure === null) setError(strings.preview.generateFailed)
      const fresh = await api.getDraft(draftId)
      if (!alive()) return false
      queryClient.setQueryData(draftKey(draftId), fresh)
      if (outcome.done) setGeneratedFrom(fresh.notes)
      return outcome.done
    } catch (err) {
      if (alive()) {
        setError(
          err instanceof ApiRequestError
            ? (strings.drawer.errors[err.code] ?? strings.preview.generateFailed)
            : strings.preview.generateFailed,
        )
      }
      return false
    } finally {
      if (alive()) {
        setGenerating(null)
        stream.current = null
      }
    }
  }

  const cancel = () => {
    if (generating?.jobId) void api.cancelJob(generating.jobId).catch(() => undefined)
  }

  return { generating, error, setError, generatedFrom, run, cancel }
}
