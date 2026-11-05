import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { strings } from '../strings'
import type { Card, CardOutput, DraftCreate, PartCard } from '../types'

/** What the header says beside the kind (§8): a world card's category, an episode's part and
 * main region, a part's milestones. From the generated card when there is one, else from the
 * saved card's relation rows, else from what the drawer was opened with. */
export function useDrawerHeadline(
  request: DraftCreate & { workId: string },
  generated: CardOutput | null,
  saved: Card | undefined,
  cards: readonly Card[],
): { details: string[]; milestones: string[] | null } {
  const cardId = request.card_id ?? null
  const savedEpisode = request.type === 'episode' && cardId !== null && generated === null
  const placement = useQuery({
    queryKey: ['relations', request.workId, 'episode_part'],
    queryFn: () => api.relations(request.workId, 'episode_part'),
    enabled: savedEpisode,
  })
  const settings = useQuery({
    queryKey: ['relations', request.workId, 'episode_region'],
    queryFn: () => api.relations(request.workId, 'episode_region'),
    enabled: savedEpisode,
  })
  const completeness = useQuery({
    queryKey: ['completeness', request.workId],
    queryFn: () => api.completeness(request.workId),
    enabled: request.type === 'part',
  })

  if (request.type === 'world') {
    let category = request.category ?? null
    if (generated?.type === 'world') category = generated.data.category ?? category
    else if (saved?.type === 'world') category = saved.data.category ?? category
    return { details: category ? [strings.drawer.category[category]] : [], milestones: null }
  }
  if (request.type === 'episode') {
    let partId = request.part_id ?? null
    let regionId: string | null = null
    if (generated?.type === 'episode') {
      partId = generated.data.part_id
      regionId = generated.data.locations.main
    } else if (cardId !== null) {
      partId = placement.data?.relations.find((r) => r.from_id === cardId)?.to_id ?? null
      regionId =
        settings.data?.relations.find((r) => r.from_id === cardId && r.relation === 'main')
          ?.to_id ?? null
    }
    const parts = cards
      .filter((card): card is PartCard => card.type === 'part')
      .sort((a, b) => (a.data.order ?? Infinity) - (b.data.order ?? Infinity))
    const index = parts.findIndex((card) => card.id === partId)
    const part = parts[index]
    const region = cards.find((card) => card.id === regionId)
    return {
      details: [
        ...(part
          ? [
              `${strings.story.partLabel(index + 1)}${part.data.title ? ` · ${part.data.title}` : ''}`,
            ]
          : []),
        region?.name ?? strings.drawer.noPlace,
      ],
      milestones: null,
    }
  }
  if (request.type === 'part') {
    const all = completeness.data?.milestones ?? []
    const mine =
      generated?.type === 'part'
        ? all.filter((milestone) => generated.data.fulfills.includes(milestone.id))
        : cardId !== null
          ? all.filter((milestone) => milestone.parts.includes(cardId))
          : []
    return { details: [], milestones: mine.map((milestone) => milestone.text) }
  }
  return { details: [], milestones: null }
}
