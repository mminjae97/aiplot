import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * draft lives in server memory only: whenever the drawer goes (closed, or its screen left),
 * the draft is deleted and a running turn stops (§6). */
export function CardDrawer({ request, onClose }: Props) {
  const queryClient = useQueryClient()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [pending, setPending] = useState<{ user: string; reply: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState<number[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [names, setNames] = useState<SimilarName[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [notesFailed, setNotesFailed] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  // Lifecycle, outside render: the draft once created, whether the drawer is still mounted,
  // the running turn's stream.
  const life = useRef({ started: false, mounted: false, id: null as string | null })
  const stream = useRef<AbortController | null>(null)
  // What the window's Esc listener (set up once) needs to read now.
  const latest = useRef({ onClose, editing })
  useLayoutEffect(() => {
    latest.current = { onClose, editing }
  })

  const draft = useQuery({
    queryKey: draftKey(draftId ?? ''),
    queryFn: () => api.getDraft(draftId ?? ''),
    enabled: draftId !== null,
  })

  const turn = async (id: string, text: string, refs: string[]) => {
    const controller = new AbortController()
    stream.current = controller
    setStage('replying')
    setPending({ user: text, reply: '' })
    setError(null)
    setChanged([])
    setQuestions([])
    setNames([])
    const alive = () => !controller.signal.aborted
    try {
      await sendTurn(
        id,
        { text, refs },
        {
          onReply: (piece) => {
            if (alive()) setPending((old) => old && { ...old, reply: old.reply + piece })
          },
          onReplied: () => {
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
    if (!alive()) return
    // The turns as the server keeps them, swapped in with the pending ones in one render.
    const fresh = await api.getDraft(id).catch(() => null)
    if (!alive()) return
    if (fresh) queryClient.setQueryData(draftKey(id), fresh)
    setPending(null)
    setStage('idle')
    stream.current = null
  }

  useEffect(() => {
    const state = life.current
    state.mounted = true
    if (!state.started) {
      // Once per drawer, StrictMode's second effect run included.
      state.started = true
      const { workId, ...body } = request
      api
        .createDraft(workId, body)
        .then((created) => {
          if (!state.mounted) {
            // Gone before the draft existed: never leave it behind.
            void api.deleteDraft(created.id).catch(() => undefined)
            return
          }
          state.id = created.id
          queryClient.setQueryData(draftKey(created.id), created)
          setDraftId(created.id)
          // A new card: the AI asks first (§12 empty cards → the LLM asks first).
          if (created.card_id === null && created.turns.length === 0) {
            void turn(created.id, '', [])
          }
        })
        .catch((err: unknown) => {
          if (state.mounted) {
            setOpenError(err instanceof ApiRequestError ? err.code : 'OPEN_FAILED')
          }
        })
    }
    return () => {
      state.mounted = false
      stream.current?.abort()
      const id = state.id
      if (id !== null) {
        // StrictMode remounts at once, before any draft exists, so this is a real goodbye.
        state.id = null
        queryClient.removeQueries({ queryKey: draftKey(id) })
        void api.deleteDraft(id).catch(() => undefined)
      }
    }
    // The drawer opens one draft for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Focus moves in once, and back to where it came from when the drawer goes.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      // An open notes editor takes Esc for itself (SourcePanel); never lose its text.
      if (latest.current.editing === null) latest.current.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  const saveNotes = async (notes: string) => {
    if (draftId === null) return
    setSavingNotes(true)
    setNotesFailed(false)
    try {
      const updated = await api.putSource(draftId, notes)
      queryClient.setQueryData(draftKey(updated.id), updated)
      setChanged([])
      setEditing(null)
    } catch {
      setNotesFailed(true)
    } finally {
      setSavingNotes(false)
    }
  }

  const send = (text: string, refs: string[]) => {
    // Never while the notes are edited by hand: the turn would rewrite them underneath.
    if (draftId !== null && editing === null) void turn(draftId, text, refs)
  }

  const kind = strings.drawer.kind[request.type]
  const current = draft.data
  const turns: DraftTurn[] = current?.turns ?? []
  const category = request.category ? strings.drawer.category[request.category] : null

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && editing === null) onClose()
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
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {openError !== null ? (
          <p className="chat-error drawer-body" role="alert">
            {strings.drawer.errors[openError] ?? strings.drawer.openFailed}
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
                // While the user edits the notes, a turn would rewrite them underneath.
                locked={editing !== null}
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
                editing={editing}
                saving={savingNotes}
                saveFailed={notesFailed}
                onEdit={(text) => {
                  setNotesFailed(false)
                  setEditing(text)
                }}
                onSave={(notes) => {
                  void saveNotes(notes)
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
