import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { DeleteCardDialog, UndoToast } from '../components/CardDelete'
import { CharacterBack, CharacterFront } from '../components/CharacterCard'
import { FlipCard } from '../components/FlipCard'
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

/** S1-1 dex (§8): every character as a card on the desk, a translucent + card last. A card
 * picked up grows to the middle and flips to all its fields. */
export function CharacterDexScreen({ workId, cardId }: Props) {
  const queryClient = useQueryClient()
  const open = useNavigation((store) => store.open)
  const [picked, setPicked] = useState<{ id: string; origin: DOMRect | null } | null>(
    cardId ? { id: cardId, origin: null } : null,
  )
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
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
        <section className="dex" aria-labelledby="dex-title">
          <h2 id="dex-title" className="dex-title">
            {strings.dex.title}
          </h2>
          {characters.isError && (
            <p className="library-alert" role="alert">
              {strings.dex.loadFailed}
            </p>
          )}
          {locked && work.data && <p className="dex-note">{strings.dex.locked}</p>}
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
                    setPicked({ id: card.id, origin: event.currentTarget.getBoundingClientRect() })
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
              relations={links.data?.relations ?? []}
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
