// The region map's geometry (§8 S1-2): lines as long as the journey, pointing the way the
// notes say, parents drawn as areas around their children. Saved map_x/map_y stay put;
// regions without one are laid out around them, next to the regions they link to.
import {
  type Force,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { RegionLinkRow, RegionTravel } from '../types'

export type Point = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }

// A region's token on the map, centred on its point.
export const NODE_WIDTH = 140
export const NODE_HEIGHT = 48
// Room around an area's children, and above them for its name.
const AREA_PAD = 26
const AREA_LABEL = 26

const MINUTES = { minute: 1, hour: 60, day: 1440 } as const

/** Line length for a journey: longer trips are longer lines, on a log scale so an hour's walk
 * and a week's voyage both fit; unknown journeys get a middling length. */
export function lengthOf(travel: RegionTravel | null): number {
  if (!travel) return 220
  const minutes = travel.value * MINUTES[travel.unit]
  return Math.round(Math.min(440, 170 + 30 * Math.log2(1 + minutes / 10)))
}

/** The line's label: 3일 · 말. */
export function travelText(travel: RegionTravel | null): string | null {
  if (!travel) return null
  const unit = { minute: '분', hour: '시간', day: '일' }[travel.unit]
  const amount = `${String(Number(travel.value.toFixed(1)))}${unit}`
  return travel.mode ? `${amount} · ${travel.mode}` : amount
}

/** A compass word as written in the notes (북, 남동쪽, 서북…) → a unit vector on the screen
 * (north is up); anything else → null. */
export function directionOf(text: string | null): Point | null {
  if (!text) return null
  const word = text.replace(/\s|쪽|방향/g, '')
  if (!/^[동서남북]{1,2}$/.test(word)) return null
  const x = (word.includes('동') ? 1 : 0) - (word.includes('서') ? 1 : 0)
  const y = (word.includes('남') ? 1 : 0) - (word.includes('북') ? 1 : 0)
  if (x === 0 && y === 0) return null
  const length = Math.hypot(x, y)
  return { x: x / length, y: y / length }
}

/** One line per pair of linked regions (A→B and B→A share it), with the journey and the way
 * from a to b. Links to regions not drawn, or to the region itself, are left out. */
export type Line = {
  id: string
  a: string
  b: string
  travel: RegionTravel | null
  dir: Point | null
}

export function linesOf(rows: RegionLinkRow[], drawn: ReadonlySet<string>): Line[] {
  const byKey = new Map<string, Line>()
  for (const row of rows) {
    if (row.from_id === row.to_id || !drawn.has(row.from_id) || !drawn.has(row.to_id)) continue
    const [a, b] = row.from_id < row.to_id ? [row.from_id, row.to_id] : [row.to_id, row.from_id]
    const key = `${a}|${b}`
    const line = byKey.get(key) ?? { id: key, a, b, travel: null, dir: null }
    line.travel ??= row.travel
    const dir = directionOf(row.direction)
    // The direction is where to_id lies from from_id; store it as from a to b.
    if (dir && !line.dir) line.dir = row.from_id === a ? dir : { x: 0 - dir.x, y: 0 - dir.y }
    byKey.set(key, line)
  }
  return [...byKey.values()]
}

type Node = SimulationNodeDatum & { id: string }

/** Pulls each linked pair toward the way the notes point: b ends up that way from a. */
function forceDirection(lines: Line[]): Force<Node, undefined> {
  let byId = new Map<string, Node>()
  const force = (alpha: number) => {
    for (const line of lines) {
      const a = byId.get(line.a)
      const b = byId.get(line.b)
      if (!line.dir || !a || !b) continue
      const length = lengthOf(line.travel)
      const dx = (a.x ?? 0) + line.dir.x * length - (b.x ?? 0)
      const dy = (a.y ?? 0) + line.dir.y * length - (b.y ?? 0)
      const k = 0.12 * alpha
      b.vx = (b.vx ?? 0) + dx * k
      b.vy = (b.vy ?? 0) + dy * k
      a.vx = (a.vx ?? 0) - dx * k
      a.vy = (a.vy ?? 0) - dy * k
    }
  }
  force.initialize = (nodes: Node[]) => {
    byId = new Map(nodes.map((node) => [node.id, node]))
  }
  return force
}

/** Draws children of one parent together. */
function forceGroups(groups: string[][]): Force<Node, undefined> {
  let byId = new Map<string, Node>()
  const force = (alpha: number) => {
    for (const ids of groups) {
      const members = ids.flatMap((id) => byId.get(id) ?? [])
      if (members.length < 2) continue
      const cx = members.reduce((sum, node) => sum + (node.x ?? 0), 0) / members.length
      const cy = members.reduce((sum, node) => sum + (node.y ?? 0), 0) / members.length
      for (const node of members) {
        node.vx = (node.vx ?? 0) + (cx - (node.x ?? 0)) * 0.15 * alpha
        node.vy = (node.vy ?? 0) + (cy - (node.y ?? 0)) * 0.15 * alpha
      }
    }
  }
  force.initialize = (nodes: Node[]) => {
    byId = new Map(nodes.map((node) => [node.id, node]))
  }
  return force
}

/** Points for the drawn regions. Saved positions are fixed; the rest start next to a placed
 * region they link to (the way the notes point, if they say) and settle around them. */
export function layout(
  ids: string[],
  placed: ReadonlyMap<string, Point>,
  lines: Line[],
  groups: string[][],
): Map<string, Point> {
  const nodes: Node[] = ids.map((id, index) => {
    const at = placed.get(id)
    if (at) return { id, x: at.x, y: at.y, fx: at.x, fy: at.y }
    for (const line of lines) {
      const other = line.a === id ? line.b : line.b === id ? line.a : null
      const from = other ? placed.get(other) : undefined
      if (!from) continue
      const sign = line.b === id ? 1 : -1
      const dir = line.dir ?? { x: Math.cos(index * 2.4), y: Math.sin(index * 2.4) }
      const length = lengthOf(line.travel)
      return { id, x: from.x + sign * dir.x * length, y: from.y + sign * dir.y * length }
    }
    return { id }
  })
  const links: SimulationLinkDatum<Node>[] = lines.map((line) => ({
    source: line.a,
    target: line.b,
  }))
  const pull = placed.size > 0 ? 0 : 0.04
  forceSimulation(nodes)
    .force(
      'link',
      forceLink<Node, SimulationLinkDatum<Node>>(links)
        .id((node) => node.id)
        .distance((_, index) => lengthOf(lines[index]?.travel ?? null))
        .strength(0.6),
    )
    .force('charge', forceManyBody().strength(-500))
    .force('collide', forceCollide(NODE_WIDTH / 2 + 12))
    .force('direction', forceDirection(lines))
    .force('groups', forceGroups(groups))
    .force('x', forceX(0).strength(pull))
    .force('y', forceY(0).strength(pull))
    .stop()
    .tick(300)
  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}

/** Each parent's area: around its children's tokens and its child areas, with room for its
 * name on top. Parents nest, so inner areas come first. */
export function areasOf(
  children: ReadonlyMap<string, string[]>,
  points: ReadonlyMap<string, Point>,
): Map<string, Box> {
  const areas = new Map<string, Box>()
  const visiting = new Set<string>()
  const boxOf = (id: string): Box | null => {
    const known = areas.get(id)
    if (known) return known
    const kids = children.get(id)
    if (!kids || kids.length === 0) {
      const at = points.get(id)
      return at
        ? {
            x: at.x - NODE_WIDTH / 2,
            y: at.y - NODE_HEIGHT / 2,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          }
        : null
    }
    // A cycle in bad data must not loop: a parent already being drawn adds nothing.
    if (visiting.has(id)) return null
    visiting.add(id)
    const boxes = kids.flatMap((kid) => boxOf(kid) ?? [])
    visiting.delete(id)
    if (boxes.length === 0) return null
    const left = Math.min(...boxes.map((box) => box.x)) - AREA_PAD
    const top = Math.min(...boxes.map((box) => box.y)) - AREA_PAD - AREA_LABEL
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + AREA_PAD
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + AREA_PAD
    const area = { x: left, y: top, width: right - left, height: bottom - top }
    areas.set(id, area)
    return area
  }
  for (const id of children.keys()) boxOf(id)
  return areas
}
