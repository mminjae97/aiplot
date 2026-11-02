// The relation graph's data (§8 관계도): one line per pair of characters, its colour and dash
// from what the relations say, and a layout computed afresh every time (positions are never
// stored): stress majorization, tried from a few fixed starts, keeping the fewest crossings.
import { type Force, forceCollide, forceSimulation, type SimulationNodeDatum } from 'd3-force'
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

/** What a relation is, by its words: love (pink), friendly (blue), hostile (red), else neutral
 * (green). */
export type RelationKind = 'love' | 'friendly' | 'hostile' | 'neutral'

// Words that say the kind, anywhere in the relation's text. Family, teachers, comrades and the
// like are friendly; words in none of these lists are neutral.
const WORDS: [Exclude<RelationKind, 'neutral'>, string[]][] = [
  [
    'love',
    ['사랑', '연인', '애인', '연모', '첫사랑', '짝사랑', '약혼', '정혼', '남편', '아내', '부부'],
  ],
  [
    'friendly',
    [
      '친구',
      '절친',
      '소꿉',
      '우정',
      '동료',
      '전우',
      '룸메이트',
      '스승',
      '제자',
      '은사',
      '가족',
      '아버지',
      '어머니',
      '아빠',
      '엄마',
      '부모',
      '딸',
      '아들',
      '형',
      '오빠',
      '누나',
      '언니',
      '동생',
      '남매',
      '자매',
      '형제',
      '할아버지',
      '할머니',
      '삼촌',
      '이모',
      '고모',
      '은인',
      '신뢰',
      '존경',
      '동경',
      '모시',
      '주인',
      '가신',
      '협력',
      '돕',
      '챙기',
      '지켜',
      '고마운',
      '편한',
      '귀여워',
      '단골',
    ],
  ],
  [
    'hostile',
    [
      '숙적',
      '적대',
      '원수',
      '연적',
      '라이벌',
      '경쟁',
      '경멸',
      '증오',
      '미워',
      '거슬',
      '견제',
      '배신',
      '복수',
      '대립',
      '넘어서',
      '이용',
    ],
  ],
]

/** One side's relation → its kind; when its words say several, the first in WORDS wins
 * ("라이벌이자 절친" is friendly). */
export function kindOf(relation: string | null): RelationKind {
  if (!relation) return 'neutral'
  const text = relation.replace(/\s/g, '')
  if (text === '적') return 'hostile'
  for (const [kind, words] of WORDS) if (words.some((word) => text.includes(word))) return kind
  return 'neutral'
}

/** How a pair's line is drawn: the kind of the side(s) that feel it most (love, then hostile,
 * then friendly, then neutral), solid when both sides feel it, dashed when only one does (the
 * arrowheads point from those sides). */
export type LineStyle = {
  kind: RelationKind
  mutual: boolean
  fromA: boolean
  fromB: boolean
}

const WEIGHT: Record<RelationKind, number> = { love: 3, hostile: 2, friendly: 1, neutral: 0 }

export function styleOf(pair: Pair): LineStyle {
  const a = pair.ab === null ? null : kindOf(pair.ab)
  const b = pair.ba === null ? null : kindOf(pair.ba)
  const kind = [a, b].reduce<RelationKind>(
    (best, side) => (side !== null && WEIGHT[side] > WEIGHT[best] ? side : best),
    a ?? b ?? 'neutral',
  )
  return { kind, mutual: a === kind && b === kind, fromA: a === kind, fromB: b === kind }
}

type Point = { x: number; y: number }
type Node = SimulationNodeDatum & { id: string }

/** A faction (세력·조직 world card) and the characters in its 함께 보기: drawn as an area
 * around them; a character may be in several. */
export type Group = { id: string; name: string; members: string[] }

/** Factions with at least two of the drawn characters (one alone gets no area). */
export function groupsOf(
  factions: { id: string; name: string | null }[],
  rows: CardRelation[],
  drawn: ReadonlySet<string>,
): Group[] {
  return factions.flatMap((faction) => {
    const members = [
      ...new Set(
        rows
          .filter((row) => row.from_id === faction.id && drawn.has(row.to_id))
          .map((row) => row.to_id),
      ),
    ]
    return members.length >= 2 ? [{ id: faction.id, name: faction.name ?? '', members }] : []
  })
}

// Room (px) an area keeps around its members' centres: their discs and names.
export const GROUP_PAD = 70

/** The area around points: the convex hull of a circle of `pad` around each, so it is round at
 * the ends and keeps that room on every side. */
export function hullOf(points: Point[], pad: number): Point[] {
  const ring = points.flatMap((point) =>
    Array.from({ length: 24 }, (_, k) => ({
      x: point.x + pad * Math.cos((k * Math.PI) / 12),
      y: point.y + pad * Math.sin((k * Math.PI) / 12),
    })),
  )
  const sorted = [...ring].sort((p, q) => p.x - q.x || p.y - q.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: Point[]) => {
    const out: Point[] = []
    for (const point of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2]
        const b = out[out.length - 1]
        if (!a || !b || cross(a, b, point) > 0) break
        out.pop()
      }
      out.push(point)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

// How far (px) a character's centre keeps from a line it is not on: its disc and name clear.
const CLEARANCE = 72

/** Keeps characters off other pairs' lines: one lying on a line it is not part of is pushed
 * off it sideways, the line's ends the other way (a line under a disc reads as linked to it). */
function forceClear(pairs: Pair[]): Force<Node, undefined> {
  let nodes: Node[] = []
  let byId = new Map<string, Node>()
  const force = (alpha: number) => {
    for (const pair of pairs) {
      const a = byId.get(pair.a)
      const b = byId.get(pair.b)
      if (!a || !b) continue
      const ax = a.x ?? 0
      const ay = a.y ?? 0
      const dx = (b.x ?? 0) - ax
      const dy = (b.y ?? 0) - ay
      const length2 = dx * dx + dy * dy
      if (length2 === 0) continue
      for (const node of nodes) {
        if (node === a || node === b) continue
        const t = ((node.x ?? 0) - ax) * dx + ((node.y ?? 0) - ay) * dy
        if (t <= 0 || t >= length2) continue
        const along = t / length2
        const px = ax + dx * along
        const py = ay + dy * along
        let ox = (node.x ?? 0) - px
        let oy = (node.y ?? 0) - py
        let off = Math.hypot(ox, oy)
        if (off >= CLEARANCE) continue
        if (off < 1e-6) {
          // Right on the line: off to one side, the same side every time.
          ox = -dy
          oy = dx
          off = Math.sqrt(length2)
        }
        const push = ((CLEARANCE - off) / off) * alpha * 4
        node.vx = (node.vx ?? 0) + ox * push
        node.vy = (node.vy ?? 0) + oy * push
        a.vx = (a.vx ?? 0) - ox * push * (1 - along) * 0.5
        a.vy = (a.vy ?? 0) - oy * push * (1 - along) * 0.5
        b.vx = (b.vx ?? 0) - ox * push * along * 0.5
        b.vy = (b.vy ?? 0) - oy * push * along * 0.5
      }
    }
  }
  force.initialize = (all: Node[]) => {
    nodes = all
    byId = new Map(all.map((node) => [node.id, node]))
  }
  return force
}

// How far apart (px) two related characters lie; those further apart in the web of relations
// lie that many times as far.
const UNIT = 230
// Stress iterations per try, and the work budget (iterations × characters²) for all tries.
const ITERATIONS = 300
const BUDGET = 5e6
const MAX_TRIES = 10
// The spread is wide: the picture is stretched across to at least this width per height.
const WIDE = 1.6

/** Steps in the web of relations between every two characters (BFS); characters not linked
 * at all count as one step beyond the furthest, and two of one faction as one step at most
 * (they lie together). */
function stepsOf(ids: string[], pairs: Pair[], groups: Group[]): number[][] {
  const index = new Map(ids.map((id, i) => [id, i]))
  const next: number[][] = ids.map(() => [])
  for (const pair of pairs) {
    const a = index.get(pair.a)
    const b = index.get(pair.b)
    if (a === undefined || b === undefined) continue
    next[a]?.push(b)
    next[b]?.push(a)
  }
  const steps = ids.map((_, from) => {
    const row: number[] = ids.map(() => Infinity)
    row[from] = 0
    const queue = [from]
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head] ?? 0
      for (const to of next[at] ?? []) {
        if (row[to] !== Infinity) continue
        row[to] = (row[at] ?? 0) + 1
        queue.push(to)
      }
    }
    return row
  })
  const furthest = Math.max(0, ...steps.flat().filter((step) => step !== Infinity))
  const out = steps.map((row) => row.map((step) => (step === Infinity ? furthest + 1 : step)))
  for (const group of groups) {
    const members = group.members.flatMap((id) => index.get(id) ?? [])
    for (const a of members)
      for (const b of members) {
        const row = out[a]
        if (a !== b && row) row[b] = Math.min(row[b] ?? 1, 1)
      }
  }
  return out
}

/** Stress majorization (Gansner, Koren & North): moves each character to where its distances
 * to all others best match their steps apart, over and over. Fewer lines cross than with
 * springs and pushes alone. */
function stress(steps: number[][], start: Point[]): Point[] {
  const xs = start.map((point) => point.x)
  const ys = start.map((point) => point.y)
  const n = xs.length
  for (let round = 0; round < ITERATIONS; round++) {
    for (let i = 0; i < n; i++) {
      let sx = 0
      let sy = 0
      let sw = 0
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const want = (steps[i]?.[j] ?? 1) * UNIT
        const weight = 1 / (want * want)
        const dx = (xs[i] ?? 0) - (xs[j] ?? 0)
        const dy = (ys[i] ?? 0) - (ys[j] ?? 0)
        const now = Math.hypot(dx, dy) || 1e-6
        sx += weight * ((xs[j] ?? 0) + (want * dx) / now)
        sy += weight * ((ys[j] ?? 0) + (want * dy) / now)
        sw += weight
      }
      if (sw > 0) {
        xs[i] = sx / sw
        ys[i] = sy / sw
      }
    }
  }
  return xs.map((x, i) => ({ x, y: ys[i] ?? 0 }))
}

/** Turns the picture so its long side runs across, centres it on (0, 0) and stretches it
 * across to the spread's shape (stretching never adds a crossing). */
function widen(points: Point[]): Point[] {
  const n = points.length || 1
  const mx = points.reduce((sum, point) => sum + point.x, 0) / n
  const my = points.reduce((sum, point) => sum + point.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const point of points) {
    sxx += (point.x - mx) ** 2
    syy += (point.y - my) ** 2
    sxy += (point.x - mx) * (point.y - my)
  }
  const turn = -0.5 * Math.atan2(2 * sxy, sxx - syy)
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const turned = points.map((point) => ({
    x: (point.x - mx) * cos - (point.y - my) * sin,
    y: (point.x - mx) * sin + (point.y - my) * cos,
  }))
  const xs = turned.map((point) => point.x)
  const ys = turned.map((point) => point.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  const stretch = width > 0 ? Math.max(1, (WIDE * height) / width) : 1
  return turned.map((point) => ({ x: point.x * stretch, y: point.y }))
}

/** Keeps characters out of factions they are not in: one inside a faction's area (with room
 * for its own disc) is pushed out from the area's middle. */
function forceOutside(groups: Group[]): Force<Node, undefined> {
  let nodes: Node[] = []
  let byId = new Map<string, Node>()
  const force = (alpha: number) => {
    for (const group of groups) {
      const members = group.members.flatMap((id) => byId.get(id) ?? [])
      if (members.length < 2) continue
      const points = members.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }))
      const hull = hullOf(points, GROUP_PAD + OUTSIDE)
      const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length
      const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length
      const inside = new Set(group.members)
      for (const node of nodes) {
        if (inside.has(node.id)) continue
        const at = { x: node.x ?? 0, y: node.y ?? 0 }
        if (!within(hull, at)) continue
        const dx = at.x - cx
        const dy = at.y - cy
        const off = Math.hypot(dx, dy) || 1e-6
        node.vx = (node.vx ?? 0) + (dx / off) * 90 * alpha
        node.vy = (node.vy ?? 0) + (dy / off) * 90 * alpha
      }
    }
  }
  force.initialize = (all: Node[]) => {
    nodes = all
    byId = new Map(all.map((node) => [node.id, node]))
  }
  return force
}

// Room (px) a character outside an area keeps from its outline: its own disc and name, and
// the area's name above it.
const OUTSIDE = 80

/** Whether a point lies inside a convex polygon (hullOf's order). */
export function within(polygon: Point[], point: Point): boolean {
  if (polygon.length < 3) return false
  let sign = 0
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] ?? a
    const turn = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (turn === 0) continue
    if (sign === 0) sign = Math.sign(turn)
    else if (Math.sign(turn) !== sign) return false
  }
  return true
}

/** Pulls discs apart, off lines that are not theirs and out of factions that are not theirs,
 * moving them as little as it can. */
function tidy(ids: string[], pairs: Pair[], groups: Group[], points: Point[]): Point[] {
  const nodes: Node[] = ids.map((id, i) => ({ id, x: points[i]?.x ?? 0, y: points[i]?.y ?? 0 }))
  forceSimulation(nodes)
    .alpha(0.3)
    .force('collide', forceCollide(80))
    .force('clear', forceClear(pairs))
    .force('outside', forceOutside(groups))
    .stop()
    .tick(150)
  return nodes.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }))
}

/** How many pairs of lines cross (lines sharing a character never count). */
export function crossingsOf(at: ReadonlyMap<string, Point>, pairs: Pair[]): number {
  const turn = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  let count = 0
  for (const [i, s] of pairs.entries()) {
    for (const t of pairs.slice(i + 1)) {
      if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue
      const p1 = at.get(s.a)
      const p2 = at.get(s.b)
      const q1 = at.get(t.a)
      const q2 = at.get(t.b)
      if (!p1 || !p2 || !q1 || !q2) continue
      if (turn(p1, p2, q1) * turn(p1, p2, q2) < 0 && turn(q1, q2, p1) * turn(q1, q2, p2) < 0)
        count++
    }
  }
  return count
}

/** A fixed sequence of pseudo-random numbers (Park–Miller), so the same data always gives the
 * same picture. */
function numbers(seed: number) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** Positions centred on (0, 0), each faction's members together: a stress layout from
 * several fixed starts (as many as the
 * budget allows for this many characters), each stretched wide and tidied, keeping the one
 * whose lines cross least. */
export function layout(ids: string[], pairs: Pair[], groups: Group[] = []): Map<string, Point> {
  if (ids.length === 0) return new Map()
  const steps = stepsOf(ids, pairs, groups)
  const tries = Math.max(
    1,
    Math.min(MAX_TRIES, Math.floor(BUDGET / (ITERATIONS * ids.length * ids.length))),
  )
  const next = numbers(7)
  const spread = UNIT * Math.sqrt(ids.length)
  let best: { at: Map<string, Point>; crossings: number } | null = null
  for (let attempt = 0; attempt < tries; attempt++) {
    const start = ids.map(() => ({ x: (next() - 0.5) * spread, y: (next() - 0.5) * spread }))
    const points = tidy(ids, pairs, groups, widen(stress(steps, start)))
    const at = new Map(ids.map((id, i) => [id, points[i] ?? { x: 0, y: 0 }]))
    const crossings = crossingsOf(at, pairs)
    if (!best || crossings < best.crossings) best = { at, crossings }
    if (crossings === 0) break
  }
  return best?.at ?? new Map<string, Point>()
}
