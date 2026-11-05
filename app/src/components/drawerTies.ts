import { strings } from '../strings'
import type { Card, CardOutput } from '../types'

type CardType = Card['type']
export type TieType = keyof typeof strings.preview.tiesNote

export const hasTies = (type: CardType): type is TieType => type in strings.preview.tiesNote

/** What save writes into a relation table from this card's data (§14), with the kinds of card
 * that table takes: a character's relations, a world card's 함께 보기, a region's direct links,
 * an episode's characters. Other references (a region's parent, an episode's places, world
 * cards, prev/next/causes, origin) are not ties here. A tie's content (a relation's words, a
 * link's travel and direction) is a key compared between versions; `changed` names how a
 * change of it is marked (world and episode ties have none). */
function tiesOf(card: Card | CardOutput): {
  ties: readonly (readonly [id: string, content: string])[]
  kinds: readonly CardType[]
  changed: 'relation' | 'travel' | null
} {
  switch (card.type) {
    case 'character':
      return {
        ties: card.data.relations.map((r) => [r.target_id, r.relation] as const),
        kinds: ['character'],
        changed: 'relation',
      }
    case 'world':
      return {
        ties: card.data.related.map((id) => [id, ''] as const),
        kinds: ['character', 'region', 'world'],
        changed: null,
      }
    case 'region':
      return {
        ties: card.data.links.map(
          (l) =>
            [
              l.target_id,
              JSON.stringify([
                l.travel?.value ?? null,
                l.travel?.unit ?? null,
                l.travel?.mode ?? null,
                l.direction,
              ]),
            ] as const,
        ),
        kinds: ['region'],
        changed: 'travel',
      }
    case 'episode':
      return {
        ties: card.data.characters.map((id) => [id, ''] as const),
        kinds: ['character'],
        changed: null,
      }
    default:
      return { ties: [], kinds: [], changed: null }
  }
}

export type TieChange = { card: Card; change: 'added' | 'relation' | 'travel' | 'removed' }

/** The cards whose tie with the saved card is new, changed or gone if the generated one is saved
 * (§8): added, then changed, then removed, each in data order. Only cards of the work of the
 * right kind, never the card itself; a target listed twice keeps its last content, as save
 * keeps them (§14). */
export function changedTies(
  generated: CardOutput,
  saved: Card,
  cards: readonly Card[],
): TieChange[] {
  if (generated.type !== saved.type) return []
  const byId = new Map(cards.map((card) => [card.id, card]))
  const kept = (card: Card | CardOutput): Map<string, { card: Card; content: string }> => {
    const { ties, kinds } = tiesOf(card)
    const found = new Map<string, { card: Card; content: string }>()
    for (const [id, content] of ties) {
      const target = byId.get(id)
      if (id !== saved.id && target !== undefined && kinds.includes(target.type)) {
        found.set(id, { card: target, content })
      }
    }
    return found
  }
  const after = [...kept(generated).values()]
  const beforeMap = kept(saved)
  const before = [...beforeMap.values()]
  const now = new Set(after.map((tie) => tie.card.id))
  const changed = tiesOf(saved).changed
  const changes: TieChange[] = after
    .filter((tie) => !beforeMap.has(tie.card.id))
    .map((tie) => ({ card: tie.card, change: 'added' }))
  if (changed !== null) {
    for (const tie of after) {
      const was = beforeMap.get(tie.card.id)
      if (was !== undefined && was.content !== tie.content) {
        changes.push({ card: tie.card, change: changed })
      }
    }
  }
  for (const tie of before) {
    if (!now.has(tie.card.id)) changes.push({ card: tie.card, change: 'removed' })
  }
  return changes
}
