import { expect, test } from 'vitest'
import { layout, pairsOf } from '../src/components/relationLayout'

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
