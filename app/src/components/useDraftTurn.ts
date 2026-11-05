import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { draftKey, sendTurn, withNotes } from '../api/drafts'
import type { Draft, SimilarName } from '../types'
import type { PendingTurn } from './ChatPanel'
import { errorText } from './drawerErrors'

export type TurnStage = 'idle' | 'replying' | 'organizing'

/** One chat turn of the drawer's draft (§8): the AI's reply streams in, then the source role
 * edits the notes and leaves its questions and similar names. A running turn stops when the
 * drawer goes. `kept` = the turns the draft holds now. */
export function useDraftTurn(kept: number) {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<TurnStage>('idle')
  const [pending, setPending] = useState<PendingTurn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState<number[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [names, setNames] = useState<SimilarName[]>([])
  const stream = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      stream.current?.abort()
    },
    [],
  )

  /** True when the server kept the turn (the AI answered); a failed turn leaves none. */
  const turn = async (id: string, text: string, refs: string[]): Promise<boolean> => {
    const controller = new AbortController()
    stream.current = controller
    setStage('replying')
    // The turns kept before this one: once the draft holds more, the server has kept it.
    setPending({ user: text, reply: '', from: kept })
    setError(null)
    // Cleared for the turn; a failed one gives them back (the AI's last questions still stand).
    const before = { changed, questions, names }
    setChanged([])
    setQuestions([])
    setNames([])
    const alive = () => !controller.signal.aborted
    // Set from the event callback: never narrowed to false here.
    let answered = false as boolean
    try {
      await sendTurn(
        id,
        { text, refs },
        {
          onReply: (piece) => {
            if (alive()) setPending((old) => old && { ...old, reply: old.reply + piece })
          },
          onReplied: () => {
            answered = true
            if (alive()) setStage('organizing')
          },
          onSource: (update) => {
            if (!alive()) return
            queryClient.setQueryData<Draft>(draftKey(id), (old) => old && withNotes(old, update))
            setChanged(update.changed)
            setQuestions(update.questions)
            setNames(update.similar_names)
          },
          onError: (code) => {
            if (alive()) setError(errorText(code))
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (alive()) setError(errorText(err instanceof ApiRequestError ? err.code : ''))
    }
    if (!alive()) return answered
    if (!answered) {
      setChanged(before.changed)
      setQuestions(before.questions)
      setNames(before.names)
    }
    // The turns as the server keeps them, swapped in with the pending ones in one render.
    const fresh = await api.getDraft(id).catch(() => null)
    if (!alive()) return answered
    if (fresh) queryClient.setQueryData(draftKey(id), fresh)
    setPending(null)
    setStage('idle')
    stream.current = null
    return answered
  }

  return { stage, pending, error, changed, setChanged, questions, names, setNames, turn }
}
