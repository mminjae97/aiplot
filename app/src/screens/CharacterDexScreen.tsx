import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { DeleteCardDialog, UndoToast } from '../components/CardDelete'
import { CharacterBack, CharacterFront } from '../components/CharacterCard'
import { FlipCard } from '../components/FlipCard'
import { RelationGraph } from '../components/RelationGraph'
import { pairsOf } from '../components/relationLayout'
import { TopBar } from '../components/TopBar'
import { useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, CharacterCard } from '../types'

type Props = {
  workId: string
  /** Pick this card up on arrival (a 함께 보기 link from the world book). */
  cardId?: string
}

function isCharacter(card: Card): card is CharacterCard {
  return card.type === 'character'
}

type View = 'cards' | 'graph'
const VIEWS: View[] = ['cards', 'graph']
// 도감 | 관계도: the last one comes back (a per-viewer convenience; storage may be missing).
const VIEW_KEY = 'aiplot.dex.view'

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'cards'
  } catch {
    return 'cards'
  }
}

function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Not remembered this time; the view itself still changes.
  }
}

/** S1-1 dex (§8): every character as a card on the desk, a translucent + card last. A card
 * picked up grows to the middle and flips to all its fields. */
export function CharacterDexScreen({ workId, cardId }: Props) {
  const queryClient = useQueryClient()
  const open = useNavigation((store) => store.open)
  const [picked, setPicked] = useState<{ id: string; origin: DOMRect | null } | null>(
    cardId ? { id: cardId, origin: null } : null,
  )
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [view, setView] = useState<View>(savedView)
  const tabRefs = useRef(new Map<View, HTMLButtonElement>())
  const [deleting, setDeleting] = useState<CharacterCard | null>(null)
  const [undo, setUndo] = useState<{ card: Card; until: string } | null>(null)
  // The card just saved or brought back: highlighted 0.3s (§8).
  const [highlight, setHighlight] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const addRef = useRef<HTMLButtonElement>(null)
  // The drawer gives the focus back here when it closes (the card, or the + card).
  const returnTo = useRef<string | null>(null)

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const characters = useQuery({
    queryKey: ['cards', workId, 'character'],
    queryFn: () => api.listCards(workId, { type: 'character' }),
  })
  const all = useQuery({
    queryKey: ['cards', workId, 'all'],
    queryFn: () => api.listCards(workId),
  })
  const links = useQuery({
    queryKey: ['relations', workId, 'character'],
    queryFn: () => api.relations(workId, 'character'),
  })
  const origins = useQuery({
    queryKey: ['relations', workId, 'origin'],
    queryFn: () => api.relations(workId, 'origin'),
  })

  // Read-only until the work says otherwise (§11).
  const locked = (work.data?.locked_stage ?? 1) >= 1
  const cards = (characters.data?.cards ?? []).filter(isCharacter)
  const names = new Map(
    (all.data?.cards ?? []).flatMap((card) => (card.name ? [[card.id, card.name] as const] : [])),
  )
  const current = picked ? (cards.find((card) => card.id === picked.id) ?? null) : null
  // A link to a card that is not (or no longer) here picks nothing up, now or later.
  if (picked && characters.isSuccess && current === null) setPicked(null)

  // The highlight starts once the card is on the desk (a save refetches the list first).
  const shown = highlight !== null && cards.some((card) => card.id === highlight)
  useEffect(() => {
    if (highlight === null || !shown) return
    cardRefs.current.get(highlight)?.scrollIntoView({ block: 'nearest' })
    const timer = window.setTimeout(() => {
      setHighlight(null)
    }, 300)
    return () => {
      window.clearTimeout(timer)
    }
  }, [highlight, shown])

  const busy = drawer !== null || deleting !== null || current !== null

  const choose = (next: View) => {
    setView(next)
    saveView(next)
  }
  const onTabKey = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 'cards'
        : event.key === 'End'
          ? 'graph'
          : view === 'cards'
            ? 'graph'
            : 'cards'
    choose(next)
    tabRefs.current.get(next)?.focus()
  }
  const relations = links.data?.relations ?? []
  const pairs = pairsOf(relations, new Set(cards.map((card) => card.id)))
  // The graph is laid out afresh whenever its cards or lines change.
  const graphKey = JSON.stringify([cards.map((card) => [card.id, card.name]), pairs])
  return (
    <>
      <TopBar
        onBack={() => {
          open({ name: 'contents', workId })
        }}
        backLabel={strings.contents.toContents}
        backDisabled={busy}
        title={work.data?.title}
      />
      <main className="desk dex-desk" inert={busy}>
        <section className="dex" data-view={view} aria-labelledby="dex-title">
          <div className="dex-head">
            <h2 id="dex-title" className="dex-title">
              {strings.dex.title}
            </h2>
            <div className="dex-tabs" role="tablist" aria-label={strings.dex.views}>
              {VIEWS.map((key) => (
                <button
                  key={key}
                  ref={(node) => {
                    if (node) tabRefs.current.set(key, node)
                    else tabRefs.current.delete(key)
                  }}
                  id={`dex-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  aria-controls="dex-panel"
                  tabIndex={view === key ? 0 : -1}
                  className="dex-tab"
                  onClick={() => {
                    choose(key)
                  }}
                  onKeyDown={onTabKey}
                >
                  {key === 'cards' ? strings.dex.cardsTab : strings.dex.graphTab}
                </button>
              ))}
            </div>
          </div>
          {characters.isError && (
            <p className="library-alert" role="alert">
              {strings.dex.loadFailed}
            </p>
          )}
          {locked && work.data && <p className="dex-note">{strings.dex.locked}</p>}
          {view === 'graph' ? (
            <div
              id="dex-panel"
              role="tabpanel"
              aria-labelledby="dex-tab-graph"
              className="dex-panel"
            >
              {characters.isSuccess && cards.length === 0 ? (
                <p className="dex-note">{strings.dex.graphNoCards}</p>
              ) : (
                <>
                  <p className="dex-note">
                    {links.isSuccess && pairs.length === 0
                      ? strings.dex.graphNoLinks
                      : strings.dex.graphHint}
                  </p>
                  {cards.length > 0 && (
                    <RelationGraph
                      key={graphKey}
                      cards={cards}
                      relations={relations}
                      onPick={(id, origin) => {
                        setPicked({ id, origin })
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div
              id="dex-panel"
              role="tabpanel"
              aria-labelledby="dex-tab-cards"
              className="dex-panel"
            >
              {characters.isSuccess && cards.length === 0 && !locked && (
                <p className="dex-note">{strings.dex.empty}</p>
              )}
              <ul className="dex-grid">
                {cards.map((card) => (
                  <li key={card.id}>
                    <button
                      ref={(node) => {
                        if (node) cardRefs.current.set(card.id, node)
                        else cardRefs.current.delete(card.id)
                      }}
                      type="button"
                      className="dex-card"
                      aria-label={strings.dex.flip(card.name ?? strings.drawer.untitled)}
                      data-incomplete={card.status === 'incomplete' || undefined}
                      data-highlight={highlight === card.id || undefined}
                      onClick={(event) => {
                        setPicked({
                          id: card.id,
                          origin: event.currentTarget.getBoundingClientRect(),
                        })
                      }}
                    >
                      <CharacterFront card={card} />
                      {card.status === 'incomplete' && (
                        <span className="dex-tag">{strings.dex.incomplete}</span>
                      )}
                    </button>
                  </li>
                ))}
                {!locked && (
                  <li>
                    <button
                      ref={addRef}
                      type="button"
                      className="dex-card dex-new"
                      onClick={() => {
                        returnTo.current = null
                        setDrawer({ workId, type: 'character' })
                      }}
                    >
                      <span className="dex-new-plus" aria-hidden="true">
                        +
                      </span>
                      <span className="dex-name">{strings.dex.newCard}</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>
      </main>
      {current && picked && (
        <FlipCard
          origin={picked.origin}
          label={current.name ?? strings.drawer.untitled}
          covered={deleting !== null}
          onClose={() => {
            setPicked(null)
          }}
          front={<CharacterFront card={current} />}
          back={
            <CharacterBack
              card={current}
              names={names}
              relations={relations}
              origins={origins.data?.relations ?? []}
              locked={locked}
              onEdit={() => {
                returnTo.current = current.id
                setPicked(null)
                setDrawer({ workId, type: 'character', card_id: current.id })
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
            const back = returnTo.current
            returnTo.current = null
            window.requestAnimationFrame(() => {
              ;((back ? cardRefs.current.get(back) : undefined) ?? addRef.current)?.focus()
            })
          }}
          onSaved={(card) => {
            // After save: close and highlight the card (§8).
            void queryClient.invalidateQueries({ queryKey: ['relations', workId] })
            returnTo.current = card.id
            setHighlight(card.id)
          }}
        />
      )}
      {deleting && (
        <DeleteCardDialog
          card={deleting}
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
          onRestored={(card) => {
            setUndo(null)
            setHighlight(card.id)
          }}
        />
      )}
    </>
  )
}
