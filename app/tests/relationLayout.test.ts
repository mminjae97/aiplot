import { expect, test } from 'vitest'
import {
  crossingsOf,
  GROUP_PAD,
  groupsOf,
  hullOf,
  kindOf,
  layout,
  pairsOf,
  styleOf,
  within,
} from '../src/components/relationLayout'

const drawn = new Set(['c_a', 'c_b', 'c_c'])

test('A→B and B→A share one line, each relation at its own end', () => {
  expect(
    pairsOf(
      [
        { from_id: 'c_b', to_id: 'c_a', relation: '짝사랑' },
        { from_id: 'c_a', to_id: 'c_b', relation: '소꿉친구' },
        { from_id: 'c_c', to_id: 'c_a', relation: '스승' },
      ],
      drawn,
    ),
  ).toEqual([
    { id: 'c_a|c_b', a: 'c_a', b: 'c_b', ab: '소꿉친구', ba: '짝사랑' },
    { id: 'c_a|c_c', a: 'c_a', b: 'c_c', ab: null, ba: '스승' },
  ])
})

test('rows to undrawn cards or to the card itself draw nothing; repeats join', () => {
  expect(
    pairsOf(
      [
        { from_id: 'c_a', to_id: 'c_a', relation: '자기 자신' },
        { from_id: 'c_a', to_id: 'c_gone', relation: '유령' },
        { from_id: 'c_a', to_id: 'c_b', relation: '동료' },
        { from_id: 'c_a', to_id: 'c_b', relation: '빚쟁이' },
      ],
      drawn,
    ),
  ).toEqual([{ id: 'c_a|c_b', a: 'c_a', b: 'c_b', ab: '동료, 빚쟁이', ba: null }])
})

test('the layout is the same for the same data, linked cards at about the line length', () => {
  const ids = ['c_a', 'c_b', 'c_c']
  const pairs = pairsOf([{ from_id: 'c_a', to_id: 'c_b', relation: '동료' }], drawn)
  const first = layout(ids, pairs)
  expect(layout(ids, pairs)).toEqual(first)
  const at = (id: string) => first.get(id) ?? { x: NaN, y: NaN }
  const gap = (p: string, q: string) => Math.hypot(at(p).x - at(q).x, at(p).y - at(q).y)
  expect(gap('c_a', 'c_b')).toBeGreaterThan(180)
  expect(gap('c_a', 'c_b')).toBeLessThan(280)
  // Nobody sits on top of anybody, and the loner stays near the others.
  for (const [p, q] of [
    ['c_a', 'c_c'],
    ['c_b', 'c_c'],
  ] as const) {
    expect(gap(p, q)).toBeGreaterThan(140)
    expect(gap(p, q)).toBeLessThan(500)
  }
})

test('a relation is love, friendly, hostile or else neutral by its words', () => {
  for (const text of ['짝사랑', '첫사랑이자 소꿉친구', '정혼자', '약혼자'])
    expect(kindOf(text)).toBe('love')
  for (const text of ['절친', '라이벌이자 절친', '아버지', '스승', '모시는 황태녀', '옛 전우'])
    expect(kindOf(text)).toBe('friendly')
  for (const text of ['숙적', '연적', '넘어서야 할 상대', '적'])
    expect(kindOf(text)).toBe('hostile')
  for (const text of ['의뢰인', '같은 반 친구의 형'.slice(0, 4), '', null])
    expect(kindOf(text)).toBe('neutral')
})

test('a line takes the strongest side, solid only when both sides feel it', () => {
  const pair = (ab: string | null, ba: string | null) => ({ id: 'x', a: 'c_a', b: 'c_b', ab, ba })
  expect(styleOf(pair('연인', '약혼자'))).toEqual({
    kind: 'love',
    mutual: true,
    fromA: true,
    fromB: true,
  })
  // One-sided love over the other side's respect: dashed, the arrow from the one in love.
  expect(styleOf(pair('모시는 황태녀', '짝사랑'))).toEqual({
    kind: 'love',
    mutual: false,
    fromA: false,
    fromB: true,
  })
  expect(styleOf(pair('스승', null))).toEqual({
    kind: 'friendly',
    mutual: false,
    fromA: true,
    fromB: false,
  })
  expect(styleOf(pair('절친', '숙적')).kind).toBe('hostile')
})

test('crossing lines are counted, lines meeting at a character are not', () => {
  const at = new Map([
    ['c_a', { x: 0, y: 0 }],
    ['c_b', { x: 10, y: 10 }],
    ['c_c', { x: 0, y: 10 }],
    ['c_d', { x: 10, y: 0 }],
  ])
  const pair = (a: string, b: string) => ({ id: `${a}|${b}`, a, b, ab: '', ba: null })
  expect(crossingsOf(at, [pair('c_a', 'c_b'), pair('c_c', 'c_d')])).toBe(1)
  expect(crossingsOf(at, [pair('c_a', 'c_b'), pair('c_a', 'c_c')])).toBe(0)
})

test('a web that can be drawn without crossings is drawn without them, wide and apart', () => {
  // A 3×3 grid of friends: planar, so the best layout crosses nothing.
  const ids = Array.from({ length: 9 }, (_, i) => `c_${String(i)}`)
  const rows = ids.flatMap((id, i) => [
    ...(i % 3 < 2 ? [{ from_id: id, to_id: ids[i + 1] ?? '', relation: '친구' }] : []),
    ...(i < 6 ? [{ from_id: id, to_id: ids[i + 3] ?? '', relation: '친구' }] : []),
  ])
  const pairs = pairsOf(rows, new Set(ids))
  const at = layout(ids, pairs)
  expect(crossingsOf(at, pairs)).toBe(0)
  const points = [...at.values()]
  for (const [i, p] of points.entries())
    for (const q of points.slice(i + 1))
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(150)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys))
})

test('a faction groups the drawn characters in its 함께 보기, two at least', () => {
  const drawn = new Set(['c_a', 'c_b', 'c_c'])
  const rows = [
    { from_id: 'c_order', to_id: 'c_a', relation: null },
    { from_id: 'c_order', to_id: 'c_b', relation: null },
    { from_id: 'c_order', to_id: 'c_b', relation: null },
    { from_id: 'c_order', to_id: 'c_region', relation: null },
    { from_id: 'c_guild', to_id: 'c_c', relation: null },
  ]
  expect(
    groupsOf(
      [
        { id: 'c_order', name: '기사단' },
        { id: 'c_guild', name: '길드' },
      ],
      rows,
      drawn,
    ),
  ).toEqual([{ id: 'c_order', name: '기사단', members: ['c_a', 'c_b'] }])
})

test("a faction's area keeps its room round every member", () => {
  const hull = hullOf(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    50,
  )
  expect(within(hull, { x: 100, y: 0 })).toBe(true)
  expect(within(hull, { x: -45, y: 0 })).toBe(true)
  expect(within(hull, { x: 100, y: 60 })).toBe(false)
  expect(within(hull, { x: 260, y: 0 })).toBe(false)
})

test("a faction's members lie together and nobody else lies in their area", () => {
  const ids = ['c_a', 'c_b', 'c_c', 'c_d', 'c_e', 'c_f']
  // A chain a-b-c-d-e-f; a and f are in one faction although far apart in the chain.
  const rows = ids.slice(1).map((id, i) => ({ from_id: ids[i] ?? '', to_id: id, relation: '동료' }))
  const pairs = pairsOf(rows, new Set(ids))
  const group = { id: 'c_order', name: '기사단', members: ['c_a', 'c_f'] }
  const at = layout(ids, pairs, [group])
  const point = (id: string) => at.get(id) ?? { x: NaN, y: NaN }
  const gap = Math.hypot(point('c_a').x - point('c_f').x, point('c_a').y - point('c_f').y)
  expect(gap).toBeLessThan(360)
  const hull = hullOf([point('c_a'), point('c_f')], GROUP_PAD)
  for (const id of ['c_b', 'c_c', 'c_d', 'c_e']) expect(within(hull, point(id))).toBe(false)
})
