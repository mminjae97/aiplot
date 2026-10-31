// The story timeline's grid (§8 S1-3): story order left to right, split by part; a lane per
// region top to bottom; an episode sits in its main region's lane and leaves a small marker
// in the lanes of the other places it visits. All from the relation tables (§6).
import type { CardRelation, MilestoneFulfilment } from '../types'

export type TimelinePart = { id: string; label: string }
/** `rows`: how many episodes stack in its busiest column (simultaneous, same place). */
export type Lane = { id: string | null; label: string; rows: number }
/** `row`: the episode's place in its lane's stack within that column. */
export type Placed = { episodeId: string; column: number; lane: number; row: number }
export type Span = { partId: string; label: string; first: number; last: number }
export type Arrow = { from: string; to: string; kind: 'order' | 'cause' }

export type Timeline = {
  columns: number
  spans: Span[]
  lanes: Lane[]
  nodes: Placed[]
  markers: Placed[]
  arrows: Arrow[]
  /** Episode id -> the milestone it is coloured by (its first one), as an index into
   * `milestones`. */
  milestoneOf: Map<string, number>
  /** Milestone index -> the column it sits above (its first episode, else its part's start). */
  milestoneColumns: Map<number, number>
}

type Input = {
  parts: TimelinePart[]
  /** episode_part rows: episode -> part, relation = order within the part. */
  placement: CardRelation[]
  /** episode_region rows: episode -> region, relation 'main' for the main one. */
  settings: CardRelation[]
  /** episode_link rows. */
  links: CardRelation[]
  milestones: MilestoneFulfilment[]
  /** Region id -> name, in the order regions were made (lane order). */
  regions: ReadonlyMap<string, string>
  /** The lane for episodes without a main place. */
  nowhere: string
}

export function timelineOf(input: Input): Timeline {
  const spans: Span[] = []
  const columnOf = new Map<string, number>()
  let column = 0
  for (const part of input.parts) {
    // Episodes of this part by their order; the same order = the same column (simultaneous).
    const rows = input.placement
      .filter((row) => row.to_id === part.id)
      .map((row) => ({ id: row.from_id, order: Number(row.relation ?? NaN) }))
      .sort((a, b) => (a.order || Infinity) - (b.order || Infinity))
    const first = column
    rows.forEach((row, index) => {
      const before = rows[index - 1]
      // A new column unless it shares the previous episode's order (unknown orders never do).
      if (before && !(row.order === before.order && Number.isFinite(row.order))) column += 1
      columnOf.set(row.id, column)
    })
    // An empty part still takes a column, so its title and band show.
    spans.push({ partId: part.id, label: part.label, first, last: column })
    column += 1
  }

  const mainOf = new Map<string, string>()
  const othersOf = new Map<string, string[]>()
  for (const row of input.settings) {
    if (!columnOf.has(row.from_id) || !input.regions.has(row.to_id)) continue
    if (row.relation === 'main') mainOf.set(row.from_id, row.to_id)
    else othersOf.set(row.from_id, [...(othersOf.get(row.from_id) ?? []), row.to_id])
  }
  const used = new Set([...mainOf.values(), ...[...othersOf.values()].flat()])
  const lanes: Lane[] = [...input.regions]
    .filter(([id]) => used.has(id))
    .map(([id, label]) => ({ id, label, rows: 1 }))
  const homeless = [...columnOf.keys()].some((id) => !mainOf.has(id))
  if (homeless) lanes.push({ id: null, label: input.nowhere, rows: 1 })
  const laneOf = (region: string | null) => lanes.findIndex((lane) => lane.id === region)

  const nodes: Placed[] = []
  const markers: Placed[] = []
  // Simultaneous episodes in the same place stack in their cell instead of covering each other.
  const filled = new Map<string, number>()
  for (const [episodeId, at] of columnOf) {
    const lane = laneOf(mainOf.get(episodeId) ?? null)
    const cell = `${String(at)}|${String(lane)}`
    const row = filled.get(cell) ?? 0
    filled.set(cell, row + 1)
    const home = lanes[lane]
    if (home) home.rows = Math.max(home.rows, row + 1)
    nodes.push({ episodeId, column: at, lane, row })
    for (const region of othersOf.get(episodeId) ?? []) {
      if (region === mainOf.get(episodeId)) continue
      markers.push({ episodeId, column: at, lane: laneOf(region), row: 0 })
    }
  }

  const arrows: Arrow[] = input.links
    .filter((row) => columnOf.has(row.from_id) && columnOf.has(row.to_id))
    .map((row) => ({
      from: row.from_id,
      to: row.to_id,
      kind: row.relation === 'cause' ? 'cause' : 'order',
    }))

  const milestoneOf = new Map<string, number>()
  const milestoneColumns = new Map<number, number>()
  input.milestones.forEach((milestone, index) => {
    for (const id of milestone.episodes) if (!milestoneOf.has(id)) milestoneOf.set(id, index)
    const columns = milestone.episodes.flatMap((id) => columnOf.get(id) ?? [])
    const span = spans.find((item) => milestone.parts.includes(item.partId))
    const at = columns.length > 0 ? Math.min(...columns) : span?.first
    if (at !== undefined) milestoneColumns.set(index, at)
  })

  return {
    columns: column,
    spans,
    lanes,
    nodes,
    markers,
    arrows,
    milestoneOf,
    milestoneColumns,
  }
}
