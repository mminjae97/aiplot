import { strings } from '../strings'
import type { CardReference } from '../types'
import type { TieChange, TieType } from './drawerTies'

/** Before saving a new name (§8): the cards that reference this one. */
export function ReferencesNotice({ references }: { references: readonly CardReference[] }) {
  return (
    <div className="preview-references" role="note">
      <h4>{strings.preview.references}</h4>
      <p>{strings.preview.referencesNote}</p>
      <ul>
        {references.map((ref) => (
          <li key={`${ref.card_id}:${ref.field}`}>
            {ref.name ?? strings.drawer.untitled}
            <span className="chat-mention-kind"> {strings.drawer.kind[ref.type]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Before saving changed ties (§8): each card gaining, changing or losing one. */
export function TiesNotice({ type, ties }: { type: TieType; ties: readonly TieChange[] }) {
  return (
    <div className="preview-references" role="note">
      <h4>{strings.preview.ties}</h4>
      <p>{strings.preview.tiesNote[type]}</p>
      <ul>
        {ties.map(({ card, change }) => (
          <li key={card.id}>
            {card.name ?? strings.drawer.untitled}
            <span className="chat-mention-kind"> {strings.drawer.kind[card.type]}</span>
            {' · '}
            {strings.preview.tie[change]}
          </li>
        ))}
      </ul>
    </div>
  )
}
