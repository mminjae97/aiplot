import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { draftKey, sendTurn, withNotes } from '../api/drafts'
import { strings } from '../strings'
import type { Draft, DraftCreate, DraftTurn, SimilarName } from '../types'
import { ChatPanel } from './ChatPanel'
import { SourcePanel } from './SourcePanel'

export type DrawerRequest = DraftCreate & { workId: string }

type Props = {
  request: DrawerRequest
  onClose: () => void
}

type Stage = 'idle' | 'replying' | 'organizing'

function errorText(code: string): string {
  return strings.drawer.errors[code] ?? strings.drawer.failed
}

/** The card drawer (§8): chat and source notes on the left, the card on the right. Its
 * draft lives in server memory only and goes when the drawer closes (§6). */
export function CardDrawer({ request, onClose }: Props) {
  const queryClient = useQueryClient()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [pending, setPending] = useState<{ user: string; reply: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState<number[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [names, setNames] = useState<SimilarName[]>([])
  const started = useRef(false)
  const panel = useRef<HTMLDivElement>(null)

  const draft = useQuery({
    queryKey: draftKey(draftId ?? ''),
    queryFn: () => api.getDraft(draftId ?? ''),
    enabled: draftId !== null,
  })

  const turn = useCallback(
    async (id: string, text: string, refs: string[]) => {
      setStage('replying')
      setPending({ user: text, reply: '' })
      setError(null)
      try {
        await sendTurn(
          id,
          { text, refs },
          {
            onReply: (piece) => {
              setPending((old) => old && { ...old, reply: old.reply + piece })
            },
            onReplied: () => {
              setStage('organizing')
            },
            onSource: (update) => {
              queryClient.setQueryData<Draft>(draftKey(id), (old) => old && withNotes(old, update))
              setChanged(update.changed)
              setQuestions(update.questions)
              setNames(update.similar_names)
            },
            onError: (code) => {
              setError(errorText(code))
            },
          },
        )
      } catch (err) {
        setError(errorText(err instanceof ApiRequestError ? err.code : ''))
      } finally {
        await queryClient.invalidateQueries({ queryKey: draftKey(id) })
        setPending(null)
        setStage('idle')
      }
    },
    [queryClient],
  )

  const open = useMutation({
    mutationFn: () => {
      const { workId, ...body } = request
      return api.createDraft(workId, body)
    },
    onSuccess: (created) => {
      queryClient.setQueryData(draftKey(created.id), created)
      setDraftId(created.id)
      // A new card: the AI asks first (§12 empty cards → the LLM asks first).
      if (created.card_id === null && created.turns.length === 0) void turn(created.id, '', [])
    },
  })

  useEffect(() => {
    // Once per drawer, StrictMode's second effect run included.
    if (started.current) return
    started.current = true
    open.mutate()
  }, [open])

  const close = useCallback(() => {
    if (draftId !== null) {
      queryClient.removeQueries({ queryKey: draftKey(draftId) })
      // The server forgets the conversation (§6); a failure only leaves it in memory.
      void api.deleteDraft(draftId).catch(() => undefined)
    }
    onClose()
  }, [draftId, onClose, queryClient])

  useEffect(() => {
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [close])

  const saveNotes = useMutation({
    mutationFn: (notes: string) => api.putSource(draftId ?? '', notes),
    onSuccess: (updated) => {
      queryClient.setQueryData(draftKey(updated.id), updated)
      setChanged([])
    },
  })

  const send = (text: string, refs: string[]) => {
    if (draftId !== null) void turn(draftId, text, refs)
  }

  const kind = strings.drawer.kind[request.type]
  const current = draft.data
  const turns: DraftTurn[] = current?.turns ?? []
  const category = request.category ? strings.drawer.category[request.category] : null

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
      >
        <header className="drawer-head">
          <p className="drawer-kind">
            {kind} · {request.card_id ? strings.drawer.edit : strings.drawer.new}
            {category && ` · ${category}`}
          </p>
          <h2 id="drawer-title">{current?.generated?.name ?? strings.drawer.untitled}</h2>
          <button
            type="button"
            className="drawer-close"
            aria-label={strings.drawer.close}
            onClick={close}
          >
            ×
          </button>
        </header>
        {open.isError ? (
          <p className="chat-error drawer-body" role="alert">
            {open.error instanceof ApiRequestError
              ? errorText(open.error.code)
              : strings.drawer.openFailed}
          </p>
        ) : !current ? (
          <p className="drawer-body" role="status">
            <span className="spinner" aria-hidden="true" />
            {strings.drawer.opening}
          </p>
        ) : (
          <div className="drawer-body">
            <div className="drawer-left">
              <ChatPanel
                workId={request.workId}
                turns={turns}
                pending={pending}
                stage={stage}
                error={error}
                onSend={send}
              />
              <SourcePanel
                notes={current.notes}
                sentences={current.sentences}
                changed={changed}
                questions={questions}
                similarNames={names}
                busy={stage !== 'idle'}
                saving={saveNotes.isPending}
                saveFailed={saveNotes.isError}
                onSave={(notes) => {
                  saveNotes.mutate(notes)
                }}
                onSameName={(pair) => {
                  setNames((old) => old.filter((p) => p !== pair))
                  send(
                    strings.drawer.sameMessage(pair.mentioned, pair.similar_to),
                    pair.card_id ? [pair.card_id] : [],
                  )
                }}
                onDismissName={(pair) => {
                  setNames((old) => old.filter((p) => p !== pair))
                }}
              />
            </div>
            <section className="drawer-preview" aria-labelledby="preview-title">
              <h3 id="preview-title" className="drawer-section-title">
                {strings.drawer.previewTitle}
              </h3>
              <p className="notes-empty">{strings.drawer.previewEmpty}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
