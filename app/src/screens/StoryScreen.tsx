import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { DeleteCardDialog, UndoToast } from '../components/CardDelete'
import { CompletenessPanel } from '../components/CompletenessPanel'
import { EpisodeBack, EpisodeFront } from '../components/EpisodeCard'
import { EpisodeTimeline } from '../components/EpisodeTimeline'
import { FlipCard } from '../components/FlipCard'
import { timelineOf } from '../components/storyLayout'
import { Overlay } from '../components/Overlay'
import type { PlanningScreen, StoryStep } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, EpisodeCard, MainStoryCard, PartCard } from '../types'
import { STORY_STEPS } from './planningPages'
import type { PageProps } from './PlanningBook'

type Step = StoryStep
const STEPS = STORY_STEPS

function isMain(card: Card): card is MainStoryCard {
  return card.type === 'main_story'
}
function isPart(card: Card): card is PartCard {
  return card.type === 'part'
}
function isEpisode(card: Card): card is EpisodeCard {
  return card.type === 'episode'
}

/** S1-3 story (§8): ① the main story, ② its parts, ③ the episodes, each step opening once
 * the one before is done (parts need a saved main story; episodes need every milestone in
 * exactly one part). */
export function StoryScreen({
  screen,
  turn,
  onBusy,
}: PageProps<Extract<PlanningScreen, { name: 'story' }>>) {
  const { workId } = screen
  const queryClient = useQueryClient()
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [deleting, setDeleting] = useState<Card | null>(null)
  const [undo, setUndo] = useState<{ card: Card; until: string } | null>(null)
  const [picked, setPicked] = useState<{ id: string; origin: DOMRect | null } | null>(null)
  const [chosenPart, setPart] = useState<string | null>(null)
  const tabRefs = useRef(new Map<Step, HTMLButtonElement>())

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const mains = useQuery({
    queryKey: ['cards', workId, 'main_story'],
    queryFn: () => api.listCards(workId, { type: 'main_story' }),
  })
  const partCards = useQuery({
    queryKey: ['cards', workId, 'part'],
    queryFn: () => api.listCards(workId, { type: 'part' }),
  })
  const episodeCards = useQuery({
    queryKey: ['cards', workId, 'episode'],
    queryFn: () => api.listCards(workId, { type: 'episode' }),
  })
  const placement = useQuery({
    queryKey: ['relations', workId, 'episode_part'],
    queryFn: () => api.relations(workId, 'episode_part'),
  })
  const links = useQuery({
    queryKey: ['relations', workId, 'episode_link'],
    queryFn: () => api.relations(workId, 'episode_link'),
  })
  const settings = useQuery({
    queryKey: ['relations', workId, 'episode_region'],
    queryFn: () => api.relations(workId, 'episode_region'),
  })
  const cast = useQuery({
    queryKey: ['relations', workId, 'episode_character'],
    queryFn: () => api.relations(workId, 'episode_character'),
  })
  const regions = useQuery({
    queryKey: ['cards', workId, 'region'],
    queryFn: () => api.listCards(workId, { type: 'region' }),
  })
  const all = useQuery({
    queryKey: ['cards', workId, 'all'],
    queryFn: () => api.listCards(workId),
  })
  const completeness = useQuery({
    queryKey: ['completeness', workId],
    queryFn: () => api.completeness(workId),
  })

  // Read-only until the work says otherwise (§11).
  const locked = (work.data?.locked_stage ?? 1) >= 1
  const main = (mains.data?.cards ?? []).find(isMain) ?? null
  const parts = (partCards.data?.cards ?? [])
    .filter(isPart)
    .sort((a, b) => (a.data.order ?? Infinity) - (b.data.order ?? Infinity))
  const episodes = (episodeCards.data?.cards ?? []).filter(isEpisode)
  const milestones = completeness.data?.milestones ?? []
  const partName = (id: string, index?: number) => {
    const part = parts.find((card) => card.id === id)
    const order = index ?? (part ? parts.indexOf(part) : -1)
    // A part the card list has not caught up with yet reads as untitled, never as its id.
    return part
      ? `${strings.story.partLabel(order + 1)}${part.data.title ? ` · ${part.data.title}` : ''}`
      : strings.drawer.untitled
  }

  const names = new Map(
    (all.data?.cards ?? []).flatMap((card) => (card.name ? [[card.id, card.name] as const] : [])),
  )
  const episodeById = new Map(episodes.map((card) => [card.id, card]))
  const timeline = timelineOf({
    parts: parts.map((part) => ({ id: part.id, label: partName(part.id) })),
    placement: placement.data?.relations ?? [],
    settings: settings.data?.relations ?? [],
    links: links.data?.relations ?? [],
    milestones,
    regions: new Map(
      (regions.data?.cards ?? []).map((card) => [card.id, card.name ?? strings.drawer.untitled]),
    ),
    nowhere: strings.story.nowhere,
  })
  // New episodes go to the part picked on the timeline; until then, the last part.
  const selectedPart = parts.find((part) => part.id === chosenPart)?.id ?? parts.at(-1)?.id ?? null
  const current = picked ? (episodeById.get(picked.id) ?? null) : null
  if (picked && episodeCards.isSuccess && current === null) setPicked(null)

  // Nothing is decided (open steps, empty states) before the cards and milestones are in.
  const loaded = mains.isSuccess && partCards.isSuccess && completeness.isSuccess
  // Steps open in order (§8).
  const partsOpen = main !== null
  const episodesOpen =
    loaded &&
    partsOpen &&
    parts.length > 0 &&
    milestones.every((milestone) => milestone.parts.length === 1)
  const isOpen = (step: Step) => step === 'main' || (step === 'parts' ? partsOpen : episodesOpen)
  // Each open step is a page of the book; without one asked for (or once the asked one has
  // closed), the furthest open step.
  const furthest: Step = episodesOpen ? 'episodes' : partsOpen ? 'parts' : 'main'
  const page: Step = screen.step && (!loaded || isOpen(screen.step)) ? screen.step : furthest
  // A closed step is no page: its tab only shows why, over the page it was opened on.
  const [peek, setPeek] = useState<{ step: Step; on: Step } | null>(null)
  const step: Step = peek?.on === page ? peek.step : page

  const choose = (next: Step) => {
    if (isOpen(next)) {
      setPeek(null)
      turn({ name: 'story', workId, step: next })
    } else {
      setPeek({ step: next, on: page })
    }
    tabRefs.current.get(next)?.focus()
  }
  const onTabKey = (event: KeyboardEvent) => {
    const at = STEPS.indexOf(step)
    const next =
      event.key === 'ArrowRight'
        ? STEPS[(at + 1) % STEPS.length]
        : event.key === 'ArrowLeft'
          ? STEPS[(at + STEPS.length - 1) % STEPS.length]
          : event.key === 'Home'
            ? STEPS[0]
            : event.key === 'End'
              ? STEPS[STEPS.length - 1]
              : undefined
    if (next === undefined) return
    event.preventDefault()
    choose(next)
  }

  const label = {
    main: strings.story.stepMain,
    parts: strings.story.stepParts,
    episodes: strings.story.stepEpisodes,
  }
  const busy = drawer !== null || deleting !== null || current !== null
  useEffect(() => {
    onBusy(busy)
    return () => {
      // A page leaving the book never leaves it shut.
      onBusy(false)
    }
  }, [busy, onBusy])
  const loadFailed =
    mains.isError ||
    partCards.isError ||
    episodeCards.isError ||
    completeness.isError ||
    placement.isError ||
    settings.isError ||
    links.isError ||
    regions.isError

  const actions = (card: Card) =>
    !locked && (
      <div className="world-actions story-actions">
        <button
          type="button"
          className="paper-button"
          onClick={() => {
            setDrawer({ workId, type: card.type, card_id: card.id })
          }}
        >
          {strings.story.editSource}
        </button>
        <button
          type="button"
          className="paper-button"
          data-danger
          onClick={() => {
            setDeleting(card)
          }}
        >
          {strings.story.delete}
        </button>
      </div>
    )

  return (
    <>
      <article className="spread spread-wide">
        <section className="page-wide dex story" aria-labelledby="story-title">
          <div className="dex-head">
            <h2 id="story-title" className="dex-title">
              {strings.story.title}
            </h2>
            <div className="dex-tabs" role="tablist" aria-label={strings.story.steps}>
              {STEPS.map((key) => (
                <button
                  key={key}
                  ref={(node) => {
                    if (node) tabRefs.current.set(key, node)
                    else tabRefs.current.delete(key)
                  }}
                  id={`story-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={step === key}
                  aria-controls="story-panel"
                  tabIndex={step === key ? 0 : -1}
                  className="dex-tab"
                  data-later={!isOpen(key) || undefined}
                  onClick={() => {
                    choose(key)
                  }}
                  onKeyDown={onTabKey}
                >
                  {label[key]}
                </button>
              ))}
            </div>
          </div>
          {loadFailed && (
            <p className="library-alert" role="alert">
              {strings.story.loadFailed}
            </p>
          )}
          {locked && work.data && <p className="dex-note">{strings.story.locked}</p>}
          <div
            id="story-panel"
            role="tabpanel"
            aria-labelledby={`story-tab-${step}`}
            className="story-sheet"
          >
            {!loaded && !loadFailed && <span className="spinner" aria-hidden="true" />}
            {loaded &&
              step === 'main' &&
              (main === null ? (
                <div className="story-empty">
                  <p>{strings.story.noMain}</p>
                  {!locked && (
                    <button
                      type="button"
                      className="paper-button"
                      data-primary
                      onClick={() => {
                        setDrawer({ workId, type: 'main_story' })
                      }}
                    >
                      {strings.story.createMain}
                    </button>
                  )}
                </div>
              ) : (
                <article className="story-main">
                  <p className="drawer-kind">
                    {strings.drawer.kind.main_story}
                    {main.status === 'incomplete' && (
                      <span className="dex-incomplete"> · {strings.dex.incomplete}</span>
                    )}
                  </p>
                  <h3 className="story-theme">{main.data.theme ?? strings.preview.undecided}</h3>
                  <dl className="story-facts">
                    <div>
                      <dt>{strings.fields.premise}</dt>
                      <dd>{main.data.premise ?? strings.preview.undecided}</dd>
                    </div>
                    <div>
                      <dt>{strings.fields.ending}</dt>
                      <dd>{main.data.ending ?? strings.preview.undecided}</dd>
                    </div>
                  </dl>
                  <h4>{strings.story.milestones}</h4>
                  <ol className="story-milestones">
                    {milestones.map((milestone) => (
                      <li key={milestone.id}>
                        <span>{milestone.text}</span>
                        <span
                          className="story-assigned"
                          data-warning={milestone.parts.length !== 1 || undefined}
                        >
                          {milestone.parts.length === 0
                            ? strings.story.unassigned
                            : milestone.parts.length > 1
                              ? strings.story.doubled(
                                  milestone.parts.map((id) => partName(id)).join(', '),
                                )
                              : strings.story.inPart(partName(milestone.parts[0] ?? ''))}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {actions(main)}
                </article>
              ))}
            {loaded &&
              step === 'parts' &&
              (!partsOpen ? (
                <p className="story-later">{strings.story.needMain}</p>
              ) : (
                <>
                  {milestones.some((milestone) => milestone.parts.length === 0) && (
                    <div className="story-missing" role="status">
                      <p>{strings.story.missingMilestones}</p>
                      <ul>
                        {milestones
                          .filter((milestone) => milestone.parts.length === 0)
                          .map((milestone) => (
                            <li key={milestone.id}>{milestone.text}</li>
                          ))}
                      </ul>
                    </div>
                  )}
                  {parts.length === 0 && <p className="story-later">{strings.story.noParts}</p>}
                  <ol className="story-parts">
                    {parts.map((part, index) => (
                      <li key={part.id} className="story-part">
                        <p className="drawer-kind">
                          {strings.story.partLabel(index + 1)}
                          {part.status === 'incomplete' && (
                            <span className="dex-incomplete"> · {strings.dex.incomplete}</span>
                          )}
                        </p>
                        <h3>{part.data.title ?? strings.preview.undecided}</h3>
                        {part.data.theme && <p className="story-part-theme">{part.data.theme}</p>}
                        <p className="story-part-span">
                          {strings.story.fromTo(
                            part.data.start ?? strings.preview.undecided,
                            part.data.end ?? strings.preview.undecided,
                          )}
                        </p>
                        <ul className="dex-traits">
                          {milestones
                            .filter((milestone) => milestone.parts.includes(part.id))
                            .map((milestone) => (
                              <li key={milestone.id}>{milestone.text}</li>
                            ))}
                        </ul>
                        {actions(part)}
                      </li>
                    ))}
                  </ol>
                  {!locked && (
                    <button
                      type="button"
                      className="paper-button story-add"
                      onClick={() => {
                        setDrawer({ workId, type: 'part' })
                      }}
                    >
                      {strings.story.newPart}
                    </button>
                  )}
                </>
              ))}
            {loaded &&
              step === 'episodes' &&
              (!episodesOpen ? (
                <p className="story-later">
                  {partsOpen ? strings.story.needParts : strings.story.needMain}
                </p>
              ) : (
                <div className="story-board">
                  <div className="story-timeline">
                    <div className="story-toolbar">
                      {!locked && (
                        <button
                          type="button"
                          className="paper-button"
                          disabled={selectedPart === null}
                          title={selectedPart === null ? strings.story.selectPartFirst : undefined}
                          onClick={() => {
                            if (selectedPart) {
                              setDrawer({ workId, type: 'episode', part_id: selectedPart })
                            }
                          }}
                        >
                          {strings.story.newEpisodeIn(
                            selectedPart ? partName(selectedPart) : strings.drawer.kind.part,
                          )}
                        </button>
                      )}
                      <span className="story-legend">
                        <span>{strings.story.legendOrder}</span>
                        <span>{strings.story.legendCause}</span>
                        <span>{strings.story.legendMarker}</span>
                      </span>
                    </div>
                    {/* Drawn once its places, links and regions are in: no lane jumps. */}
                    {placement.isSuccess &&
                    settings.isSuccess &&
                    links.isSuccess &&
                    regions.isSuccess ? (
                      <EpisodeTimeline
                        timeline={timeline}
                        episodes={episodeById}
                        milestones={milestones}
                        selectedPart={selectedPart}
                        onSelectPart={setPart}
                        onPick={(id, origin) => {
                          setPicked({ id, origin })
                        }}
                      />
                    ) : (
                      <span className="spinner" aria-hidden="true" />
                    )}
                  </div>
                  <CompletenessPanel completeness={completeness.data} names={names} />
                </div>
              ))}
          </div>
        </section>
      </article>
      <Overlay>
        {current && picked && (
          <FlipCard
            origin={picked.origin}
            label={current.name ?? strings.drawer.untitled}
            covered={deleting !== null}
            onClose={() => {
              setPicked(null)
            }}
            front={<EpisodeFront card={current} />}
            back={
              <EpisodeBack
                card={current}
                names={names}
                characters={(cast.data?.relations ?? [])
                  .filter((row) => row.from_id === current.id)
                  .map((row) => row.to_id)}
                completeness={completeness.data}
                locked={locked}
                onEdit={() => {
                  setPicked(null)
                  setDrawer({ workId, type: 'episode', card_id: current.id })
                }}
                onDelete={() => {
                  setDeleting(current)
                }}
              />
            }
          />
        )}
        {drawer && (
          <CardDrawer
            request={drawer}
            onClose={() => {
              setDrawer(null)
            }}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['relations', workId] })
            }}
          />
        )}
        {deleting && (
          <DeleteCardDialog
            card={deleting}
            asksReconnect={
              // The server joins prev and next only when the episode has both.
              isEpisode(deleting) &&
              (links.data?.relations ?? []).some(
                (row) => row.relation === 'order' && row.to_id === deleting.id,
              ) &&
              (links.data?.relations ?? []).some(
                (row) => row.relation === 'order' && row.from_id === deleting.id,
              )
            }
            partEpisodes={
              isPart(deleting)
                ? {
                    count: (placement.data?.relations ?? []).filter(
                      (row) => row.to_id === deleting.id,
                    ).length,
                    otherParts: parts
                      .filter((part) => part.id !== deleting.id)
                      .map((part) => ({ id: part.id, name: partName(part.id) })),
                  }
                : undefined
            }
            onCancel={() => {
              setDeleting(null)
            }}
            onDeleted={(until) => {
              setUndo({ card: deleting, until })
              setDeleting(null)
              setPicked(null)
            }}
          />
        )}
        {undo && (
          <UndoToast
            card={undo.card}
            until={undo.until}
            onDone={() => {
              setUndo(null)
            }}
            onRestored={() => {
              setUndo(null)
            }}
          />
        )}
      </Overlay>
    </>
  )
}
