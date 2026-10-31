import type { ReactNode } from 'react'
import { strings } from '../strings'
import type { CardRelation, CharacterCard } from '../types'
import { bindingOf, letteringOf } from './bookColor'
import { labelOf, undecided } from './cardFields'

/** The front's picture: the chosen image once images exist (step 10), until then the name's
 * first letter on a cloth colour stable per card (§8 fallback). */
export function Portrait({ card }: { card: CharacterCard }) {
  const cloth = bindingOf(card.id)
  const [first] = new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(
    (card.name ?? '').trim(),
  )
  const letter = first?.segment ?? '?'
  return (
    <div className="portrait" style={{ background: cloth, color: letteringOf(cloth) }}>
      <span aria-hidden="true">{letter}</span>
    </div>
  )
}

export function CharacterFront({ card }: { card: CharacterCard }) {
  return (
    <>
      <Portrait card={card} />
      <p className="dex-name">{card.name ?? strings.drawer.untitled}</p>
    </>
  )
}

type BackProps = {
  card: CharacterCard
  /** Card id → name, for relation targets and the origin region. */
  names: Map<string, string>
  /** char_relation rows of the work (§6: references come from relation tables). */
  relations: CardRelation[]
  /** Origin regions (character table), character -> region. */
  origins: CardRelation[]
  locked: boolean
  onEdit: () => void
  onDelete: () => void
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

/** The back: every field (§8), required ones shown as 아직 정해지지 않음 while empty; then
 * 원문 수정 on the left and the red 삭제 on the right. */
export function CharacterBack({
  card,
  names,
  relations,
  origins,
  locked,
  onEdit,
  onDelete,
}: BackProps) {
  const { data } = card
  const ties = relations
    .filter((link) => link.from_id === card.id && names.has(link.to_id))
    .map((link) => ({ name: names.get(link.to_id) ?? '', relation: link.relation }))
  const originId = origins.find((link) => link.from_id === card.id)?.to_id
  const origin = originId ? names.get(originId) : undefined
  return (
    <div className="dex-back">
      <header className="dex-back-head">
        <p className="drawer-kind">
          {strings.drawer.kind.character}
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
        <Field path="personality.traits" value={data.personality.traits}>
          <ul className="dex-traits">
            {data.personality.traits.map((trait, index) => (
              <li key={index}>{trait}</li>
            ))}
          </ul>
        </Field>
        {data.personality.behaviors.length > 0 && (
          <Field path="personality.behaviors" value={data.personality.behaviors}>
            <ul className="dex-list">
              {data.personality.behaviors.map((behavior, index) => (
                <li key={index}>
                  <span className="dex-situation">{behavior.situation}</span> → {behavior.action}
                </li>
              ))}
            </ul>
          </Field>
        )}
        <Field path="speech.description" value={data.speech.description}>
          <p>{data.speech.description}</p>
        </Field>
        <Field path="speech.examples" value={data.speech.examples}>
          <ul className="dex-quotes">
            {data.speech.examples.map((line, index) => (
              <li key={index}>“{line}”</li>
            ))}
          </ul>
        </Field>
        <Field path="appearance.summary" value={data.appearance.summary}>
          <p>{data.appearance.summary}</p>
        </Field>
        {data.appearance.details && (
          <Field path="appearance.details" value={data.appearance.details}>
            <p>{data.appearance.details}</p>
          </Field>
        )}
        {ties.length > 0 && (
          <Field path="relations" value={ties}>
            <ul className="dex-list">
              {ties.map((tie, index) => (
                <li key={index}>
                  {tie.name}
                  {tie.relation && <span className="dex-situation"> — {tie.relation}</span>}
                </li>
              ))}
            </ul>
          </Field>
        )}
        {origin && (
          <Field path="origin_region_id" value={origin}>
            <p>{origin}</p>
          </Field>
        )}
      </div>
      <div className="world-actions">
        <button type="button" className="paper-button" disabled={locked} onClick={onEdit}>
          {strings.dex.editSource}
        </button>
        <button
          type="button"
          className="paper-button"
          data-danger
          disabled={locked}
          onClick={onDelete}
        >
          {strings.dex.delete}
        </button>
      </div>
    </div>
  )
}
