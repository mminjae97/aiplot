// The relation graph's data (§8 관계도): one line per pair of characters, a label at each
// end, and a force layout computed afresh every time (positions are never stored).
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { CardRelation } from '../types'

/** One line between a and b: a's relation to b (shown at a's end) and b's to a. */
export type Pair = {
  id: string
  a: string
  b: string
  ab: string | null
  ba: string | null
}

/** char_relation rows → one pair per two characters (A→B and B→A share a line). Rows to a
 * card that is not drawn, or to the card itself, are left out. */
export function pairsOf(relations: CardRelation[], drawn: ReadonlySet<string>): Pair[] {
  const byKey = new Map<string, Pair>()
  for (const { from_id: from, to_id: to, relation } of relations) {
    if (from === to || !drawn.has(from) || !drawn.has(to)) continue
    const [a, b] = from < to ? [from, to] : [to, from]
    const key = `${a}|${b}`
    const pair = byKey.get(key) ?? { id: key, a, b, ab: null, ba: null }
    const text = relation ?? ''
    if (from === a) pair.ab = pair.ab ? `${pair.ab}, ${text}` : text
    else pair.ba = pair.ba ? `${pair.ba}, ${text}` : text
    byKey.set(key, pair)
  }
  return [...byKey.values()]
}

type Point = { x: number; y: number }
type Node = SimulationNodeDatum & { id: string }

/** Force layout centred on (0, 0): linked characters pull together, all push apart, and a
 * weak pull to the middle keeps loners close. The start positions are d3's fixed spiral,
 * so the same data gives the same picture. */
export function layout(ids: string[], pairs: Pair[]): Map<string, Point> {
  const nodes: Node[] = ids.map((id) => ({ id }))
  const links: SimulationLinkDatum<Node>[] = pairs.map((pair) => ({
    source: pair.a,
    target: pair.b,
  }))
  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<Node, SimulationLinkDatum<Node>>(links)
        .id((node) => node.id)
        .distance(230),
    )
    .force('charge', forceManyBody().strength(-600))
    .force('collide', forceCollide(80))
    .force('x', forceX(0).strength(0.06))
    .force('y', forceY(0).strength(0.06))
    .force('center', forceCenter(0, 0))
    .stop()
  simulation.tick(300)
  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}
