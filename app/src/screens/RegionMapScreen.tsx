import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CardDrawer, type DrawerRequest } from '../components/CardDrawer'
import { DeleteCardDialog, UndoToast } from '../components/CardDelete'
import { FlipCard } from '../components/FlipCard'
import { RegionBack, RegionFront } from '../components/RegionCard'
import { RegionMap } from '../components/RegionMap'
import { Overlay } from '../components/Overlay'
import type { PlanningScreen } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, RegionCard } from '../types'
import type { PageProps } from './PlanningBook'

function isRegion(card: Card): card is RegionCard {
  return card.type === 'region'
}

/** S1-2 region map (§8): regions on a sheet of paper, lines as long as the journey, parents
 * as dashed areas; dragging a region saves its place (map_x/map_y only). */
export function RegionMapScreen({
  screen,
  onBusy,
}: PageProps<Extract<PlanningScreen, { name: 'regions' }>>) {
  const { workId, cardId } = screen
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<{ id: string; origin: DOMRect | null } | null>(
    cardId ? { id: cardId, origin: null } : null,
  )
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [deleting, setDeleting] = useState<RegionCard | null>(null)
  const [undo, setUndo] = useState<{ card: Card; until: string } | null>(null)
  const [moveFailed, setMoveFailed] = useState(false)
  // Bumped when a move could not be saved: the map is drawn again from what is saved.
  const [revision, setRevision] = useState(0)

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const regions = useQuery({
    queryKey: ['cards', workId, 'region'],
    queryFn: () => api.listCards(workId, { type: 'region' }),
  })
  const all = useQuery({
    queryKey: ['cards', workId, 'all'],
    queryFn: () => api.listCards(workId),
  })
  const links = useQuery({
    queryKey: ['relations', workId, 'region-links'],
    queryFn: () => api.regionLinks(workId),
  })
  const parents = useQuery({
    queryKey: ['relations', workId, 'parent'],
    queryFn: () => api.relations(workId, 'parent'),
  })
  const settings = useQuery({
    queryKey: ['relations', workId, 'episode_region'],
    queryFn: () => api.relations(workId, 'episode_region'),
  })

  // Read-only until the work says otherwise (§11).
  const locked = (work.data?.locked_stage ?? 1) >= 1
  const cards = (regions.data?.cards ?? []).filter(isRegion)
  const names = new Map(
    (all.data?.cards ?? []).flatMap((card) => (card.name ? [[card.id, card.name] as const] : [])),
  )
  const episodes = new Map<string, string[]>()
  for (const row of settings.data?.relations ?? []) {
    const name = names.get(row.from_id)
    if (name) episodes.set(row.to_id, [...(episodes.get(row.to_id) ?? []), name])
  }
  const current = picked ? (cards.find((card) => card.id === picked.id) ?? null) : null
  // A link to a region that is not (or no longer) here picks nothing up, now or later.
  if (picked && regions.isSuccess && current === null) setPicked(null)

  const ready =
    regions.isSuccess && all.isSuccess && links.isSuccess && parents.isSuccess && settings.isSuccess
  // Laid out afresh whenever the regions, their lines, parents or episodes change; a saved
  // move alone does not (the token is already where it was dropped).
  const mapKey = JSON.stringify([
    cards.map((card) => [card.id, card.name, card.status]),
    links.data?.links,
    parents.data?.relations,
    [...episodes],
  ])

  const busy = drawer !== null || deleting !== null || current !== null
  useEffect(() => {
    onBusy(busy)
    return () => {
      // A page leaving the book never leaves it shut.
      onBusy(false)
    }
  }, [busy, onBusy])
  return (
    <>
      <article className="spread spread-wide">
        <section className="page-wide dex" data-view="graph" aria-labelledby="map-title">
          <div className="dex-head">
            <h2 id="map-title" className="dex-title">
              {strings.map.title}
            </h2>
            {!locked && (
              <button
                type="button"
                className="dex-tab"
                onClick={() => {
                  setDrawer({ workId, type: 'region' })
                }}
              >
                {strings.map.newRegion}
              </button>
            )}
          </div>
          <div className="dex-panel">
            {regions.isError && (
              <p className="library-alert" role="alert">
                {strings.map.loadFailed}
              </p>
            )}
            {moveFailed && (
              <p className="library-alert" role="alert">
                {strings.map.moveFailed}
              </p>
            )}
            {regions.isSuccess && cards.length === 0 ? (
              <p className="dex-note">{locked ? strings.map.emptyLocked : strings.map.empty}</p>
            ) : (
              <>
                {work.data && (
                  <p className="dex-note">{locked ? strings.map.hintLocked : strings.map.hint}</p>
                )}
                {ready && work.data && (
                  <RegionMap
                    key={`${mapKey}:${String(locked)}:${String(revision)}`}
                    cards={cards}
                    links={links.data.links}
                    parents={parents.data.relations}
                    episodes={episodes}
                    locked={locked}
                    onPick={(id, origin) => {
                      setPicked({ id, origin })
                    }}
                    onMove={(id, at) => {
                      setMoveFailed(false)
                      api
                        .moveRegion(id, at.x, at.y)
                        .then(() => queryClient.invalidateQueries({ queryKey: ['cards', workId] }))
                        .catch(() => {
                          setMoveFailed(true)
                          setRevision((n) => n + 1)
                        })
                    }}
                  />
                )}
              </>
            )}
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
            front={<RegionFront card={current} />}
            back={
              <RegionBack
                card={current}
                names={names}
                links={links.data?.links ?? []}
                parents={parents.data?.relations ?? []}
                episodes={episodes.get(current.id) ?? []}
                locked={locked}
                onEdit={() => {
                  setPicked(null)
                  setDrawer({ workId, type: 'region', card_id: current.id })
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
