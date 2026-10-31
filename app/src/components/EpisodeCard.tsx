import type { ReactNode } from 'react'
import { strings } from '../strings'
import type { Completeness, EpisodeCard } from '../types'
import { labelOf, undecided } from './cardFields'

/** The front of an episode's card: its name and theme. */
export function EpisodeFront({ card }: { card: EpisodeCard }) {
  return (
    <div className="region-front">
      <span className="region-front-name">{card.name ?? strings.drawer.untitled}</span>
      {card.data.theme && <span className="region-front-look">{card.data.theme}</span>}
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
  card: EpisodeCard
  names: Map<string, string>
  /** episode_character rows' characters for this episode (§6). */
  characters: string[]
  completeness: Completeness | undefined
  locked: boolean
  onEdit: () => void
  onDelete: () => void
}

/** The back (§8 S1-3): theme, the milestones it fulfils, its stages, characters, the
 * foreshadowing it plants and pays off, and the synopsis; 원문 수정 and the red 삭제. */
export function EpisodeBack({
  card,
  names,
  characters,
  completeness,
  locked,
  onEdit,
  onDelete,
}: BackProps) {
  const { data } = card
  const milestones = (completeness?.milestones ?? []).filter((milestone) =>
    milestone.episodes.includes(card.id),
  )
  const plants = (completeness?.foreshadowing ?? []).filter(
    (item) => item.plant_episode_id === card.id,
  )
  const payoffs = (completeness?.foreshadowing ?? []).filter(
    (item) => item.payoff_episode_id === card.id,
  )
  const people = characters.flatMap((id) => names.get(id) ?? [])
  return (
    <div className="dex-back">
      <header className="dex-back-head">
        <p className="drawer-kind">
          {strings.drawer.kind.episode}
          {card.status === 'incomplete' && (
            <span className="dex-incomplete"> · {strings.dex.incomplete}</span>
          )}
        </p>
        <h2>{card.name ?? strings.drawer.untitled}</h2>
      </header>
      <div className="dex-fields">
        <Field path="theme" value={data.theme}>
          <p>{data.theme}</p>
        </Field>
        {milestones.length > 0 && (
          <section className="dex-field">
            <h3>{labelOf('fulfills')}</h3>
            <ul className="dex-traits">
              {milestones.map((milestone) => (
                <li key={milestone.id}>{milestone.text}</li>
              ))}
            </ul>
          </section>
        )}
        <Field path="structure" value={data.structure}>
          <ol className="dex-list">
            {data.structure?.stages.map((stage) => (
              <li key={stage.name}>
                <span className="dex-situation">{stage.name}</span> {stage.summary ?? '—'}
              </li>
            ))}
          </ol>
        </Field>
        <Field path="characters" value={people}>
          <ul className="dex-traits">
            {people.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </Field>
        {plants.length > 0 && (
          <section className="dex-field">
            <h3>{labelOf('foreshadowing.plants')}</h3>
            <ul className="dex-list">
              {plants.map((item) => (
                <li key={item.id}>
                  {item.text}
                  <span className="dex-situation">
                    {' — '}
                    {item.payoff_episode_id
                      ? strings.story.paidIn(
                          names.get(item.payoff_episode_id) ?? strings.drawer.untitled,
                        )
                      : strings.story.unpaid}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {payoffs.length > 0 && (
          <section className="dex-field">
            <h3>{labelOf('foreshadowing.payoffs')}</h3>
            <ul className="dex-list">
              {payoffs.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </section>
        )}
        <Field path="synopsis" value={data.synopsis}>
          <p>{data.synopsis}</p>
        </Field>
      </div>
      <div className="world-actions">
        <button type="button" className="paper-button" disabled={locked} onClick={onEdit}>
          {strings.story.editSource}
        </button>
        <button
          type="button"
          className="paper-button"
          data-danger
          disabled={locked}
          onClick={onDelete}
        >
          {strings.story.delete}
        </button>
      </div>
    </div>
  )
}
