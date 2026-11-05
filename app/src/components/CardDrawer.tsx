import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { draftKey } from '../api/drafts'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, DraftCreate, DraftTurn } from '../types'
import { CardPreview } from './CardPreview'
import { ChatPanel } from './ChatPanel'
import { CloseConfirm, StructureConfirm } from './DrawerConfirm'
import { errorText, saveErrorText } from './drawerErrors'
import { changedTies, hasTies } from './drawerTies'
import { ReferencesNotice, TiesNotice } from './SaveNotices'
import { SourcePanel } from './SourcePanel'
import { TypeSection } from './TypeSection'
import { useCardGeneration } from './useCardGeneration'
import { useDraftTurn } from './useDraftTurn'
import { useDrawerHeadline } from './useDrawerHeadline'

export type DrawerRequest = DraftCreate & { workId: string }

type Props = {
  request: DrawerRequest
  onClose: () => void
  /** After 저장: the drawer closes and the screen can highlight the card (§8). */
  onSaved?: (card: Card) => void
}

// Waits longer than this show progress and a way out (§5).
const LONG_WAIT_SEC = 10

/** The card drawer (§8): chat and source notes on the left, the card on the right. Its
 * draft lives in server memory only: whenever the drawer goes (closed, or its screen left),
 * the draft is deleted and a running turn or generation stops (§6). */
export function CardDrawer({ request, onClose, onSaved }: Props) {
  const queryClient = useQueryClient()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [notesFailed, setNotesFailed] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [pinned, setPinned] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // The stage count picked for a part or an episode (§7): sent with every generation.
  const [structure, setStructure] = useState<4 | 5 | null>(null)
  // 5→4 on the generated card, in code on the server (§7).
  const [converting, setConverting] = useState(false)
  // A stage count that needs the card generated again, waiting for the user's yes.
  const [asking, setAsking] = useState<4 | 5 | null>(null)
  // The notes the drawer opened with (a saved card's, else none): closing asks once they differ.
  const [openedNotes, setOpenedNotes] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  // Lifecycle, outside render: the draft once created, whether the drawer is still mounted.
  const life = useRef({
    started: false,
    mounted: false,
    id: null as string | null,
    // The draft this drawer opened, kept after a save closed it (its cache entry still goes).
    opened: null as string | null,
    // Set at once (not on the next render), so a double Ctrl+S saves once.
    saving: false,
  })

  const draft = useQuery({
    queryKey: draftKey(draftId ?? ''),
    queryFn: () => api.getDraft(draftId ?? ''),
    enabled: draftId !== null,
  })
  const saved = useQuery({
    queryKey: ['card', request.card_id ?? ''],
    queryFn: () => api.getCard(request.card_id ?? ''),
    enabled: request.card_id != null,
  })
  const cards = useQuery({
    queryKey: ['cards', request.workId, 'all'],
    queryFn: () => api.listCards(request.workId),
  })
  const current = draft.data
  const generated = current?.generated ?? null
  const { stage, pending, error, changed, setChanged, questions, names, setNames, turn } =
    useDraftTurn(current?.turns.length ?? 0)
  const generation = useCardGeneration(draftId)
  const { generating, generatedFrom } = generation
  // Before saving (§8): a new name shows on every card that references this one; changed ties
  // list the cards gaining or losing one.
  const nameChanged =
    saved.data !== undefined && generated !== null && generated.name !== saved.data.name
  const references = useQuery({
    queryKey: ['card', request.card_id ?? '', 'references'],
    queryFn: () => api.cardReferences(request.card_id ?? ''),
    enabled: nameChanged,
  })
  const ties =
    saved.data !== undefined && generated !== null
      ? changedTies(generated, saved.data, cards.data?.cards ?? [])
      : []
  const headline = useDrawerHeadline(request, generated, saved.data, cards.data?.cards ?? [])
  const pins = pinned ?? current?.pinned ?? []
  const stale = generated !== null && generatedFrom !== null && current?.notes !== generatedFrom
  const quiet =
    stage === 'idle' && generating === null && editing === null && !saving && !converting
  const canGenerate = quiet && !confirming && current !== undefined && current.notes.trim() !== ''
  const canSave = quiet && generated !== null && !stale

  // What closing would lose: a card not saved yet, notes built up or changed since opening,
  // or text typed into the notes editor.
  const unsaved =
    generated !== null ||
    (current !== undefined && current.notes !== openedNotes) ||
    (editing !== null && editing !== current?.notes)

  const requestClose = () => {
    // Mid-save the drawer stays: closing would delete the draft under the save. The stage
    // count question answers first (its own Esc keeps the card).
    if (saving || asking !== null) return
    // Ask first (§8 unsaved close asks to save).
    if (unsaved) setConfirming(true)
    else onClose()
  }
  // What the window's key listener (set up once) needs to read now.
  const latest = useRef({
    requestClose,
    editing,
    confirming,
    asking,
    generate: (): void => undefined,
    save: (): void => undefined,
  })

  /** True when a card came back (a failed or cancelled one changes nothing). */
  const generate = async (
    count: 4 | 5 | null = structure,
    pinnedNow: string[] = pins,
  ): Promise<boolean> => {
    if (draftId === null || !canGenerate) return false
    setSaveError(null)
    return generation.run(
      count === null ? { pinned: pinnedNow } : { pinned: pinnedNow, structure: count },
    )
  }

  /** Another stage count for the generated part or episode (§7): 5→4 maps the stages in code
   * and changes nothing else; any other change needs the card generated again, so it asks
   * first (the AI's split of 승 for 4→5 is not built yet). */
  const pickStructure = async (count: 4 | 5, current: 4 | 5 | null) => {
    if (draftId === null || !canGenerate) return
    if (!(current === 5 && count === 4)) {
      setAsking(count)
      return
    }
    setConverting(true)
    generation.setError(null)
    setSaveError(null)
    try {
      const updated = await api.putStructure(draftId, { type: 4 })
      queryClient.setQueryData(draftKey(updated.id), updated)
      setStructure(4)
    } catch (err) {
      generation.setError(
        err instanceof ApiRequestError && err.code in strings.drawer.errors
          ? errorText(err.code)
          : strings.typeSection.convertFailed,
      )
    } finally {
      setConverting(false)
    }
  }

  const regenerateWith = (count: 4 | 5) => {
    setAsking(null)
    // The pick holds once a card with it came back; a failure keeps the old. A pinned
    // structure would bring the old stages back: the user just chose to change them.
    void generate(
      count,
      pins.filter((path) => path !== 'structure'),
    ).then((ok) => {
      if (ok) setStructure(count)
    })
  }

  const save = async () => {
    if (draftId === null || !canSave || life.current.saving) return
    life.current.saving = true
    setSaving(true)
    setSaveError(null)
    try {
      const card = await api.saveDraft(draftId)
      // Saving closed the draft on the server already.
      life.current.id = null
      void queryClient.invalidateQueries({ queryKey: ['cards', request.workId] })
      void queryClient.invalidateQueries({ queryKey: ['completeness', request.workId] })
      queryClient.setQueryData(['card', card.id], card)
      onSaved?.(card)
      onClose()
    } catch (err) {
      setSaveError(saveErrorText(err instanceof ApiRequestError ? err.code : ''))
      life.current.saving = false
      setSaving(false)
      setConfirming(false)
    }
  }

  useLayoutEffect(() => {
    latest.current = {
      requestClose,
      editing,
      confirming,
      asking,
      generate: () => {
        void generate()
      },
      save: () => {
        void save()
      },
    }
  })

  const setDrawerOpen = useNavigation((store) => store.setDrawerOpen)
  useEffect(() => {
    // The top bar stays usable under a drawer: nothing there may leave the page while it is open.
    setDrawerOpen(true)
    return () => {
      setDrawerOpen(false)
    }
  }, [setDrawerOpen])

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
          state.opened = created.id
          setOpenedNotes(created.notes)
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
      // Never kept past the drawer (§6), saved or not.
      if (state.opened !== null) queryClient.removeQueries({ queryKey: draftKey(state.opened) })
      const id = state.id
      if (id !== null) {
        // StrictMode remounts at once, before any draft exists, so this is a real goodbye.
        // Deleting the draft also stops its generation on the server. A saved draft is
        // closed on the server already (id null).
        state.id = null
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
      if (event.isComposing) return
      const now = latest.current
      // The stage count question takes its own keys (Esc = keep the card).
      if (now.asking !== null) return
      if (event.key === 'Escape') {
        // An open notes editor takes Esc for itself (SourcePanel); never lose its text.
        if (now.confirming) return
        if (now.editing === null) now.requestClose()
      } else if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault()
        now.generate()
      } else if ((event.key === 's' || event.key === 'S') && event.ctrlKey) {
        event.preventDefault()
        now.save()
      }
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

  const send = (text: string, refs: string[]): Promise<boolean> => {
    // Never while the notes are edited by hand or a card is being made from them.
    if (draftId !== null && editing === null && generating === null) {
      return turn(draftId, text, refs)
    }
    return Promise.resolve(false)
  }

  const kind = strings.drawer.kind[request.type]
  const turns: DraftTurn[] = current?.turns ?? []
  // Ids read as names: cards, the main story's milestones, episodes' planted foreshadowing.
  const cardNames = new Map<string, string>()
  for (const card of cards.data?.cards ?? []) {
    cardNames.set(card.id, card.name ?? '')
    if (card.type === 'main_story') {
      for (const milestone of card.data.milestones) cardNames.set(milestone.id, milestone.text)
    }
    if (card.type === 'episode') {
      for (const plant of card.data.foreshadowing.plants) cardNames.set(plant.id, plant.text)
    }
  }
  // A stale card's evidence points into notes that changed: no highlight then.
  const selectedEvidence =
    selected !== null && generated !== null && !stale ? (generated.evidence[selected] ?? []) : []
  const title = generated?.name ?? saved.data?.name ?? strings.drawer.untitled
  const long = generating !== null && generating.seconds >= LONG_WAIT_SEC

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          editing === null &&
          !confirming &&
          asking === null
        ) {
          requestClose()
        }
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
            {[kind, request.card_id ? strings.drawer.edit : strings.drawer.new, ...headline.details]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h2 id="drawer-title">{title}</h2>
          {headline.milestones !== null && (
            <p className="drawer-meta">
              {strings.fields.fulfills}:{' '}
              {headline.milestones.length > 0
                ? headline.milestones.join(' · ')
                : strings.drawer.noMilestones}
            </p>
          )}
          <button
            type="button"
            className="drawer-close"
            aria-label={strings.drawer.close}
            onClick={requestClose}
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
          <div className="drawer-body" inert={confirming || asking !== null}>
            <div className="drawer-left">
              <ChatPanel
                workId={request.workId}
                turns={turns}
                pending={pending}
                stage={stage}
                // While the notes are edited by hand or a card is made from them, a turn
                // would change them underneath.
                locked={editing !== null || generating !== null}
                error={error}
                onSend={send}
              />
              <SourcePanel
                notes={current.notes}
                sentences={current.sentences}
                changed={changed}
                evidence={selectedEvidence}
                questions={questions}
                similarNames={names}
                busy={stage !== 'idle' || generating !== null}
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
                  void send(
                    strings.drawer.sameMessage(pair.mentioned, pair.similar_to),
                    pair.card_id ? [pair.card_id] : [],
                  ).then((kept) => {
                    // Answered only once the AI took the turn; a turn that failed (its names
                    // given back) or never went leaves the question to ask again.
                    if (kept) setNames((old) => old.filter((p) => p !== pair))
                  })
                }}
                onDismissName={(pair) => {
                  setNames((old) => old.filter((p) => p !== pair))
                }}
              />
            </div>
            <section className="drawer-preview" aria-labelledby="preview-title">
              <div className="preview-head">
                <h3 id="preview-title" className="drawer-section-title">
                  {strings.drawer.previewTitle}
                </h3>
                <button
                  type="button"
                  className="paper-button"
                  data-primary={generated === null || undefined}
                  disabled={!canGenerate}
                  aria-busy={generating !== null}
                  aria-keyshortcuts="Control+Enter"
                  onClick={() => {
                    void generate()
                  }}
                >
                  {generating !== null && !long && <span className="spinner" aria-hidden="true" />}
                  {generated === null ? strings.preview.generate : strings.preview.regenerate}
                </button>
              </div>
              {long && (
                <div className="preview-progress" role="status">
                  <span className="spinner" aria-hidden="true" />
                  <p>
                    {strings.preview.generating}
                    <br />
                    <span className="notes-empty">
                      {strings.preview.elapsed(generating.seconds)}
                    </span>
                  </p>
                  <button type="button" className="paper-button" onClick={generation.cancel}>
                    {strings.preview.cancel}
                  </button>
                </div>
              )}
              {generation.error && (
                <p className="chat-error" role="alert">
                  {generation.error}
                </p>
              )}
              {converting && (
                <p className="notes-empty" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {strings.typeSection.converting}
                </p>
              )}
              {generated === null ? (
                <p className="notes-empty">
                  {current.notes.trim() ? strings.drawer.previewEmpty : strings.preview.needNotes}
                </p>
              ) : (
                <>
                  <TypeSection
                    workId={request.workId}
                    cardId={request.card_id ?? null}
                    card={generated}
                    structure={structure}
                    busy={!canGenerate}
                    onStructure={(count) => {
                      const now =
                        generated.type === 'part' || generated.type === 'episode'
                          ? (generated.data.structure?.type ?? null)
                          : null
                      void pickStructure(count, now)
                    }}
                  />
                  <CardPreview
                    card={generated}
                    saved={saved.data ?? null}
                    names={cardNames}
                    pinned={pins}
                    selected={selected}
                    onPin={(path) => {
                      setPinned(
                        pins.includes(path) ? pins.filter((p) => p !== path) : [...pins, path],
                      )
                    }}
                    onSelect={setSelected}
                  />
                  {nameChanged && (references.data?.references.length ?? 0) > 0 && (
                    <ReferencesNotice references={references.data?.references ?? []} />
                  )}
                  {ties.length > 0 && hasTies(request.type) && (
                    <TiesNotice type={request.type} ties={ties} />
                  )}
                  {stale && (
                    <p className="preview-stale" role="status">
                      {strings.preview.stale}
                    </p>
                  )}
                  {saveError && (
                    <p className="chat-error" role="alert">
                      {saveError}
                    </p>
                  )}
                  <div className="preview-actions">
                    <button
                      type="button"
                      className="paper-button"
                      data-primary
                      disabled={!canSave}
                      aria-busy={saving}
                      aria-keyshortcuts="Control+S"
                      onClick={() => {
                        void save()
                      }}
                    >
                      {saving && <span className="spinner" aria-hidden="true" />}
                      {strings.preview.save}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
        {asking !== null && (
          <StructureConfirm
            count={asking}
            onKeep={() => {
              setAsking(null)
            }}
            onRegenerate={() => {
              regenerateWith(asking)
            }}
          />
        )}
        {confirming && (
          <CloseConfirm
            hasCard={generated !== null}
            editMode={Boolean(request.card_id)}
            canSave={canSave}
            saving={saving}
            onDiscard={() => {
              setConfirming(false)
              onClose()
            }}
            onKeep={() => {
              setConfirming(false)
            }}
            onSave={() => {
              void save()
            }}
          />
        )}
      </div>
    </div>
  )
}
