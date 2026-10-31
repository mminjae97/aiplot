import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { strings } from '../strings'
import type { CardOutput } from '../types'

type Props = {
  workId: string
  /** The card being edited, if any (its own part assignment is not "another part"). */
  cardId: string | null
  card: CardOutput
  /** The stage count the user picked for a part or an episode, if any. */
  structure: 4 | 5 | null
  busy: boolean
  onStructure: (count: 4 | 5) => void
}

function Rules({ card }: { card: Extract<CardOutput, { type: 'world' }> }) {
  const { rules, terms } = card.data
  return (
    <>
      <h4>{strings.typeSection.rules}</h4>
      {rules.length === 0 ? (
        <p className="notes-empty">{strings.typeSection.noRules}</p>
      ) : (
        <ol className="type-rules">
          {rules.map((rule, index) => (
            <li key={index}>
              <p>{rule.rule}</p>
              {rule.exception && (
                <p className="type-exception">
                  <span>{strings.typeSection.exception}</span> {rule.exception}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <h4>{strings.typeSection.terms}</h4>
      {terms.length === 0 ? (
        <p className="notes-empty">{strings.typeSection.noTerms}</p>
      ) : (
        <dl className="type-terms">
          {terms.map((term) => (
            <div key={term.term}>
              <dt>{term.term}</dt>
              <dd>{term.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

function Speech({ card }: { card: Extract<CardOutput, { type: 'character' }> }) {
  const { speech } = card.data
  return (
    <>
      <h4>{strings.typeSection.speech}</h4>
      {speech.description && <p className="type-speech-note">{speech.description}</p>}
      {speech.examples.length === 0 ? (
        <p className="notes-empty">{strings.typeSection.noSpeech}</p>
      ) : (
        <ul className="type-speech">
          {speech.examples.map((line, index) => (
            <li key={index}>
              <span className="type-speaker">{card.name ?? strings.drawer.untitled}</span>
              <q>{line}</q>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function StructurePicker({
  current,
  picked,
  busy,
  onPick,
}: {
  current: 4 | 5 | null
  picked: 4 | 5 | null
  busy: boolean
  onPick: (count: 4 | 5) => void
}) {
  return (
    <>
      <h4 id="structure-title">{strings.typeSection.structure}</h4>
      <div className="type-structure" role="group" aria-labelledby="structure-title">
        {([5, 4] as const).map((count) => {
          const recommended = current === count && picked === null
          return (
            <button
              key={count}
              type="button"
              className="type-structure-option"
              aria-pressed={current === count}
              data-recommended={recommended || undefined}
              disabled={busy}
              onClick={() => {
                // Another stage count: the card is generated again with it (§7).
                if (current !== count) onPick(count)
              }}
            >
              <strong>{strings.typeSection.stages(count)}</strong>
              <span>{count === 5 ? strings.typeSection.five : strings.typeSection.four}</span>
              {recommended && <em>{strings.typeSection.recommended}</em>}
            </button>
          )
        })}
      </div>
      <p className="notes-empty">
        {current === null ? strings.typeSection.noStructure : strings.typeSection.structureNote}
      </p>
    </>
  )
}

function Milestones({
  workId,
  cardId,
  fulfills,
}: {
  workId: string
  cardId: string | null
  fulfills: string[]
}) {
  const completeness = useQuery({
    queryKey: ['completeness', workId],
    queryFn: () => api.completeness(workId),
  })
  const milestones = completeness.data?.milestones ?? []
  return (
    <>
      <h4>{strings.typeSection.milestones}</h4>
      {milestones.length === 0 ? (
        <p className="notes-empty">{strings.typeSection.noMilestones}</p>
      ) : (
        <ul className="type-milestones">
          {milestones.map((milestone) => {
            const mine = fulfills.includes(milestone.id)
            const others = milestone.parts.filter((part) => part !== cardId)
            const state = mine
              ? strings.typeSection.thisPart
              : others.length > 0
                ? strings.typeSection.otherPart
                : strings.typeSection.unassigned
            return (
              <li
                key={milestone.id}
                data-state={mine ? 'mine' : others.length > 0 ? 'other' : 'none'}
              >
                <span>{milestone.text}</span>
                <span className="type-milestone-state">{state}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="notes-empty">{strings.typeSection.milestonesNote}</p>
    </>
  )
}

/** The part of the preview each card type needs (§8): a world card's rules and terms, a
 * character's voice, the stage count of a part or an episode, a part's milestones. */
export function TypeSection({ workId, cardId, card, structure, busy, onStructure }: Props) {
  if (card.type === 'world') {
    return (
      <section className="type-section">
        <Rules card={card} />
      </section>
    )
  }
  if (card.type === 'character') {
    return (
      <section className="type-section">
        <Speech card={card} />
      </section>
    )
  }
  if (card.type === 'part' || card.type === 'episode') {
    const current = card.data.structure?.type ?? null
    return (
      <section className="type-section">
        <StructurePicker current={current} picked={structure} busy={busy} onPick={onStructure} />
        {card.type === 'part' && (
          <Milestones workId={workId} cardId={cardId} fulfills={card.data.fulfills} />
        )}
      </section>
    )
  }
  return null
}
