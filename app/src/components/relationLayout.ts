// The relation graph's data (§8 관계도): one line per pair of characters, its colour and dash
// from what the relations say, and a force layout computed afresh every time (positions are
// never stored).
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
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

/** Force layout centred on (0, 0): linked characters pull together, all push apart, nobody
 * lies on a line that is not theirs, and a weak pull to the middle keeps loners close (weaker
 * across than down, so the graph spreads wide like the book's spread). The start positions are d3's fixed spiral,
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
        .distance(260),
    )
    .force('charge', forceManyBody().strength(-900))
    .force('collide', forceCollide(80))
    .force('clear', forceClear(pairs))
    .force('x', forceX(0).strength(0.03))
    .force('y', forceY(0).strength(0.09))
    .force('center', forceCenter(0, 0))
    .stop()
  simulation.tick(600)
  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}
