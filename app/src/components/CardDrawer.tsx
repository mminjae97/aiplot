import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { draftKey, sendTurn, withNotes } from '../api/drafts'
import { streamJob } from '../api/sse'
import { strings } from '../strings'
import type {
  Card,
  CardOutput,
  Draft,
  DraftCreate,
  DraftTurn,
  PartCard,
  SimilarName,
} from '../types'
import { CardPreview } from './CardPreview'
import { ChatPanel } from './ChatPanel'
import { SourcePanel } from './SourcePanel'
import { TypeSection } from './TypeSection'

export type DrawerRequest = DraftCreate & { workId: string }

type Props = {
  request: DrawerRequest
  onClose: () => void
  /** After 저장: the drawer closes and the screen can highlight the card (§8). */
  onSaved?: (card: Card) => void
}

type Stage = 'idle' | 'replying' | 'organizing'

// Waits longer than this show progress and a way out (§5).
const LONG_WAIT_SEC = 10

function errorText(code: string): string {
  return strings.drawer.errors[code] ?? strings.drawer.failed
}

function saveErrorText(code: string): string {
  if (code === 'CARD_STALE') return strings.preview.stale
  if (code === 'CARD_CONFLICT') return strings.preview.conflict
  return strings.drawer.errors[code] ?? strings.preview.saveFailed
}

/** Same items in any order? (a list of relations or characters, for the edit-mode check) */
function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  const key = (items: readonly unknown[]) =>
    items
      .map((item) => JSON.stringify(item))
      .sort()
      .join('\n')
  return a.length === b.length && key(a) === key(b)
}

/** Did the generated card change what other cards show of the saved one (§8: its name,
 * a character's relations, an episode's characters)? */
function changesReferences(generated: CardOutput, saved: Card): boolean {
  if (generated.name !== saved.name) return true
  if (generated.type === 'character' && saved.type === 'character') {
    return !sameItems(generated.data.relations, saved.data.relations)
  }
  if (generated.type === 'episode' && saved.type === 'episode') {
    return !sameItems(generated.data.characters, saved.data.characters)
  }
  return false
}

/** What the header says beside the kind (§8): a world card's category, an episode's part and
 * main region, a part's milestones. From the generated card when there is one, else from the
 * saved card's relation rows, else from what the drawer was opened with. */
function useHeadline(
  request: DrawerRequest,
  generated: CardOutput | null,
  saved: Card | undefined,
  cards: readonly Card[],
): { details: string[]; milestones: string[] | null } {
  const cardId = request.card_id ?? null
  const savedEpisode = request.type === 'episode' && cardId !== null && generated === null
  const placement = useQuery({
    queryKey: ['relations', request.workId, 'episode_part'],
    queryFn: () => api.relations(request.workId, 'episode_part'),
    enabled: savedEpisode,
  })
  const settings = useQuery({
    queryKey: ['relations', request.workId, 'episode_region'],
    queryFn: () => api.relations(request.workId, 'episode_region'),
    enabled: savedEpisode,
  })
  const completeness = useQuery({
    queryKey: ['completeness', request.workId],
    queryFn: () => api.completeness(request.workId),
    enabled: request.type === 'part',
  })

  if (request.type === 'world') {
    let category = request.category ?? null
    if (generated?.type === 'world') category = generated.data.category ?? category
    else if (saved?.type === 'world') category = saved.data.category ?? category
    return { details: category ? [strings.drawer.category[category]] : [], milestones: null }
  }
  if (request.type === 'episode') {
    let partId = request.part_id ?? null
    let regionId: string | null = null
    if (generated?.type === 'episode') {
      partId = generated.data.part_id
      regionId = generated.data.locations.main
    } else if (cardId !== null) {
      partId = placement.data?.relations.find((r) => r.from_id === cardId)?.to_id ?? null
      regionId =
        settings.data?.relations.find((r) => r.from_id === cardId && r.relation === 'main')
          ?.to_id ?? null
    }
    const parts = cards
      .filter((card): card is PartCard => card.type === 'part')
      .sort((a, b) => (a.data.order ?? Infinity) - (b.data.order ?? Infinity))
    const index = parts.findIndex((card) => card.id === partId)
    const part = parts[index]
    const region = cards.find((card) => card.id === regionId)
    return {
      details: [
        ...(part
          ? [
              `${strings.story.partLabel(index + 1)}${part.data.title ? ` · ${part.data.title}` : ''}`,
            ]
          : []),
        region?.name ?? strings.drawer.noPlace,
      ],
      milestones: null,
    }
  }
  if (request.type === 'part') {
    const all = completeness.data?.milestones ?? []
    const mine =
      generated?.type === 'part'
        ? all.filter((milestone) => generated.data.fulfills.includes(milestone.id))
        : cardId !== null
          ? all.filter((milestone) => milestone.parts.includes(cardId))
          : []
    return { details: [], milestones: mine.map((milestone) => milestone.text) }
  }
  return { details: [], milestones: null }
}

/** The card drawer (§8): chat and source notes on the left, the card on the right. Its
 * draft lives in server memory only: whenever the drawer goes (closed, or its screen left),
 * the draft is deleted and a running turn or generation stops (§6). */
export function CardDrawer({ request, onClose, onSaved }: Props) {
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
  const [generating, setGenerating] = useState<{ jobId: string | null; seconds: number } | null>(
    null,
  )
  const [genError, setGenError] = useState<string | null>(null)
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
  // The notes the shown card was generated from: once they change, the card is stale.
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null)
  // The notes the drawer opened with (a saved card's, else none): closing asks once they differ.
  const [openedNotes, setOpenedNotes] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const keepWriting = useRef<HTMLButtonElement>(null)
  const keepCard = useRef<HTMLButtonElement>(null)
  // Lifecycle, outside render: the draft once created, whether the drawer is still mounted,
  // the running turn's and generation's streams.
  const life = useRef({
    started: false,
    mounted: false,
    id: null as string | null,
    // Set at once (not on the next render), so a double Ctrl+S saves once.
    saving: false,
  })
  const stream = useRef<AbortController | null>(null)
  const genStream = useRef<AbortController | null>(null)

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
  const nameChanged =
    saved.data !== undefined && generated !== null && generated.name !== saved.data.name
  // Other cards show this one's name, relations or characters: list them before saving (§8).
  const referencesChanged =
    saved.data !== undefined && generated !== null && changesReferences(generated, saved.data)
  const references = useQuery({
    queryKey: ['card', request.card_id ?? '', 'references'],
    queryFn: () => api.cardReferences(request.card_id ?? ''),
    enabled: referencesChanged,
  })
  const headline = useHeadline(request, generated, saved.data, cards.data?.cards ?? [])
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

  /** True when the server kept the turn (the AI answered); a failed turn leaves none. */
  const turn = async (id: string, text: string, refs: string[]): Promise<boolean> => {
    const controller = new AbortController()
    stream.current = controller
    setStage('replying')
    setPending({ user: text, reply: '' })
    setError(null)
    setChanged([])
    setQuestions([])
    setNames([])
    const alive = () => !controller.signal.aborted
    let kept = false
    try {
      await sendTurn(
        id,
        { text, refs },
        {
          onReply: (piece) => {
            if (alive()) setPending((old) => old && { ...old, reply: old.reply + piece })
          },
          onReplied: () => {
            kept = true
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
    if (!alive()) return kept
    // The turns as the server keeps them, swapped in with the pending ones in one render.
    const fresh = await api.getDraft(id).catch(() => null)
    if (!alive()) return kept
    if (fresh) queryClient.setQueryData(draftKey(id), fresh)
    setPending(null)
    setStage('idle')
    stream.current = null
    return kept
  }

  /** True when a card came back (a failed or cancelled one changes nothing). */
  const generate = async (
    count: 4 | 5 | null = structure,
    pinnedNow: string[] = pins,
  ): Promise<boolean> => {
    if (draftId === null || !canGenerate) return false
    const controller = new AbortController()
    genStream.current = controller
    const alive = () => !controller.signal.aborted
    setGenError(null)
    setSaveError(null)
    setGenerating({ jobId: null, seconds: 0 })
    try {
      const accepted = await api.generateCard(
        draftId,
        count === null ? { pinned: pinnedNow } : { pinned: pinnedNow, structure: count },
      )
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
      if (failure !== null && failure !== 'CANCELLED') setGenError(errorText(failure))
      // The stream ended without a result (dropped, or a restarted server).
      else if (!outcome.done && failure === null) setGenError(strings.preview.generateFailed)
      const fresh = await api.getDraft(draftId)
      if (!alive()) return false
      queryClient.setQueryData(draftKey(draftId), fresh)
      if (outcome.done) setGeneratedFrom(fresh.notes)
      return outcome.done
    } catch (err) {
      if (alive()) {
        setGenError(
          err instanceof ApiRequestError
            ? (strings.drawer.errors[err.code] ?? strings.preview.generateFailed)
            : strings.preview.generateFailed,
        )
      }
      return false
    } finally {
      if (alive()) {
        setGenerating(null)
        genStream.current = null
      }
    }
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
    setGenError(null)
    setSaveError(null)
    try {
      const updated = await api.putStructure(draftId, { type: 4 })
      queryClient.setQueryData(draftKey(updated.id), updated)
      setStructure(4)
    } catch (err) {
      setGenError(
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

  const cancelGeneration = () => {
    if (generating?.jobId) void api.cancelJob(generating.jobId).catch(() => undefined)
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
      stream.current?.abort()
      genStream.current?.abort()
      const id = state.id
      if (id !== null) {
        // StrictMode remounts at once, before any draft exists, so this is a real goodbye.
        // Deleting the draft also stops its generation on the server.
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

  useEffect(() => {
    if (confirming) keepWriting.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (asking !== null) keepCard.current?.focus()
  }, [asking])

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
                  setNames((old) => old.filter((p) => p !== pair))
                  void send(
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
                  <button type="button" className="paper-button" onClick={cancelGeneration}>
                    {strings.preview.cancel}
                  </button>
                </div>
              )}
              {genError && (
                <p className="chat-error" role="alert">
                  {genError}
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
                  {referencesChanged && (references.data?.references.length ?? 0) > 0 && (
                    <div className="preview-references" role="note">
                      <h4>{strings.preview.references}</h4>
                      <p>
                        {nameChanged
                          ? strings.preview.referencesNote
                          : strings.preview.referencesLinksNote}
                      </p>
                      <ul>
                        {references.data?.references.map((ref) => (
                          <li key={`${ref.card_id}:${ref.field}`}>
                            {ref.name ?? strings.drawer.untitled}
                            <span className="chat-mention-kind">
                              {' '}
                              {strings.drawer.kind[ref.type]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
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
        {asking !== null && <div className="drawer-scrim" aria-hidden="true" />}
        {asking !== null && (
          <div
            className="drawer-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="structure-confirm-title"
            aria-describedby="structure-confirm-body"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setAsking(null)
              }
            }}
          >
            <h3 id="structure-confirm-title">{strings.typeSection.regenerateTitle(asking)}</h3>
            <p id="structure-confirm-body">{strings.typeSection.regenerateBody}</p>
            <div className="preview-actions">
              <button
                ref={keepCard}
                type="button"
                className="paper-button"
                onClick={() => {
                  setAsking(null)
                }}
              >
                {strings.typeSection.keepCard}
              </button>
              <button
                type="button"
                className="paper-button"
                data-danger
                onClick={() => {
                  regenerateWith(asking)
                }}
              >
                {strings.typeSection.regenerate}
              </button>
            </div>
          </div>
        )}
        {confirming && <div className="drawer-scrim" aria-hidden="true" />}
        {confirming && (
          <div
            className="drawer-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="drawer-confirm-title"
            aria-describedby="drawer-confirm-body"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setConfirming(false)
              }
            }}
          >
            <h3 id="drawer-confirm-title">
              {generated !== null ? strings.preview.unsavedTitle : strings.drawer.closeTitle}
            </h3>
            <p id="drawer-confirm-body">
              {generated !== null
                ? strings.preview.unsavedBody
                : request.card_id
                  ? strings.drawer.closeBodyEdit
                  : strings.drawer.closeBody}
            </p>
            <div className="preview-actions">
              <button
                type="button"
                className="paper-button"
                data-danger
                onClick={() => {
                  setConfirming(false)
                  onClose()
                }}
              >
                {generated !== null ? strings.preview.discard : strings.drawer.closeDiscard}
              </button>
              <button
                ref={keepWriting}
                type="button"
                className="paper-button"
                onClick={() => {
                  setConfirming(false)
                }}
              >
                {strings.preview.keep}
              </button>
              {generated !== null && (
                <button
                  type="button"
                  className="paper-button"
                  data-primary
                  disabled={!canSave}
                  aria-busy={saving}
                  onClick={() => {
                    void save()
                  }}
                >
                  {saving && <span className="spinner" aria-hidden="true" />}
                  {strings.preview.save}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
