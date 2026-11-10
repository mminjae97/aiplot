import { strings } from '../strings'
import type { Technique } from '../types'

type Props = { card: Technique | null; reason: string | null }

/** Why a card is offered, and what it is (§9): the reason, the card, its example. */
export function EvidencePanel({ card, reason }: Props) {
  if (card === null) return null
  return (
    <section className="direction-evidence" aria-label={strings.direction.evidenceTitle}>
      <h4>
        {card.name} <small>{card.name_en}</small>
      </h4>
      <dl>
        {reason && (
          <>
            <dt>{strings.direction.evidenceReason}</dt>
            <dd>{reason}</dd>
          </>
        )}
        <dt>{strings.direction.evidenceCard}</dt>
        <dd>{card.description}</dd>
        <dt>{strings.direction.evidenceExample}</dt>
        <dd>{card.example}</dd>
      </dl>
    </section>
  )
}
