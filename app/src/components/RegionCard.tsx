import type { ReactNode } from 'react'
import { strings } from '../strings'
import type { CardRelation, RegionCard, RegionLinkRow } from '../types'
import { labelOf, undecided } from './cardFields'
import { travelText } from './regionLayout'

/** The front of a region's card: its name on a paper token, as on the map. */
export function RegionFront({ card }: { card: RegionCard }) {
  return (
    <div className="region-front">
      <span className="region-front-name">{card.name ?? strings.drawer.untitled}</span>
      {card.data.appearance && <span className="region-front-look">{card.data.appearance}</span>}
    </div>
  )
}

function Field({ path, value, children }: { path: string; value: unknown; children: ReactNode }) {
  return (
    <section className="dex-field">
      <h3>{labelOf(path)}</h3>
      {undecided(path, value) ? (
        <p className="dex-undecided">{strings.preview.undecided}</p>
      ) : (
        children
      )}
    </section>
  )
}

type BackProps = {
  card: RegionCard
  names: Map<string, string>
  /** region_link rows of the work (§6). */
  links: RegionLinkRow[]
  /** region -> parent rows. */
  parents: CardRelation[]
  /** Episodes set here (episode_region). */
  episodes: string[]
  locked: boolean
  onEdit: () => void
  onDelete: () => void
}

/** The back (§8 S1-2): appearance, environment, mood and the senses, the regions it links to
 * with their journeys, its parent and the episodes set there; 원문 수정 and the red 삭제. */
export function RegionBack({
  card,
  names,
  links,
  parents,
  episodes,
  locked,
  onEdit,
  onDelete,
}: BackProps) {
  const { data } = card
  const adjacent = links.flatMap((link) => {
    const other =
      link.from_id === card.id ? link.to_id : link.to_id === card.id ? link.from_id : null
    const name = other ? names.get(other) : undefined
    if (!other || !name) return []
    const way = link.from_id === card.id ? link.direction : null
    return [{ id: other, name, travel: travelText(link.travel), way }]
  })
  const parentId = parents.find((row) => row.from_id === card.id)?.to_id
  const parent = parentId ? names.get(parentId) : undefined
  const senses = [
    ['sensory.mood', data.sensory.mood],
    ['sensory.smell', data.sensory.smell],
    ['sensory.sound', data.sensory.sound],
  ] as const
  return (
    <div className="dex-back">
      <header className="dex-back-head">
        <p className="drawer-kind">
          {strings.drawer.kind.region}
          {card.status === 'incomplete' && (
            <span className="dex-incomplete"> · {strings.dex.incomplete}</span>
          )}
        </p>
        <h2>{card.name ?? strings.drawer.untitled}</h2>
      </header>
      <div className="dex-fields">
        {parent && (
          <Field path="parent_id" value={parent}>
            <p>{parent}</p>
          </Field>
        )}
        <Field path="appearance" value={data.appearance}>
          <p>{data.appearance}</p>
        </Field>
        <Field path="environment.natural" value={data.environment.natural}>
          <p>{data.environment.natural}</p>
        </Field>
        <Field path="environment.social" value={data.environment.social}>
          <p>{data.environment.social}</p>
        </Field>
        {senses.map(([path, value]) =>
          value ? (
            <Field key={path} path={path} value={value}>
              <p>{value}</p>
            </Field>
          ) : null,
        )}
        {adjacent.length > 0 && (
          <section className="dex-field">
            <h3>{strings.map.adjacent}</h3>
            <ul className="dex-list">
              {adjacent.map((item) => (
                <li key={item.id}>
                  {item.name}
                  {(item.travel ?? item.way) && (
                    <span className="dex-situation">
                      {' — '}
                      {[item.travel, item.way].filter(Boolean).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="dex-field">
          <h3>{strings.map.episodesHeading}</h3>
          {episodes.length === 0 ? (
            <p className="dex-undecided">{strings.map.noEpisodes}</p>
          ) : (
            <ul className="dex-list">
              {episodes.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="world-actions">
        <button type="button" className="paper-button" disabled={locked} onClick={onEdit}>
          {strings.map.editSource}
        </button>
        <button
          type="button"
          className="paper-button"
          data-danger
          disabled={locked}
          onClick={onDelete}
        >
          {strings.map.delete}
        </button>
      </div>
    </div>
  )
}
