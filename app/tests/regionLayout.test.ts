import { expect, test } from 'vitest'
import {
  areasOf,
  directionOf,
  layout,
  lengthOf,
  linesOf,
  travelText,
} from '../src/components/regionLayout'

test('longer journeys draw longer lines, within bounds', () => {
  const walk = lengthOf({ value: 30, unit: 'minute', mode: '도보' })
  const ride = lengthOf({ value: 2, unit: 'hour', mode: '말' })
  const voyage = lengthOf({ value: 3, unit: 'day', mode: '배' })
  expect(walk).toBeLessThan(ride)
  expect(ride).toBeLessThan(voyage)
  expect(lengthOf({ value: 1, unit: 'minute', mode: null })).toBeGreaterThanOrEqual(150)
  expect(lengthOf({ value: 90, unit: 'day', mode: null })).toBe(440)
  expect(lengthOf(null)).toBe(220)
})

test('travel reads as amount and mode', () => {
  expect(travelText({ value: 3, unit: 'day', mode: '말' })).toBe('3일 · 말')
  expect(travelText({ value: 1.5, unit: 'hour', mode: null })).toBe('1.5시간')
  expect(travelText({ value: 30, unit: 'minute', mode: '도보' })).toBe('30분 · 도보')
  expect(travelText(null)).toBeNull()
})

test('compass words become screen directions, north up', () => {
  expect(directionOf('북')).toEqual({ x: 0, y: -1 })
  expect(directionOf('남쪽')).toEqual({ x: 0, y: 1 })
  expect(directionOf('동')).toEqual({ x: 1, y: 0 })
  const southEast = directionOf('동남쪽')
  expect(southEast?.x).toBeCloseTo(Math.SQRT1_2)
  expect(southEast?.y).toBeCloseTo(Math.SQRT1_2)
  expect(directionOf('북서 방향')?.x).toBeCloseTo(-Math.SQRT1_2)
  for (const word of [null, '', '강 건너', '동서', '남북쪽']) expect(directionOf(word)).toBeNull()
})

test('a linked pair shares one line; the direction is kept from a to b', () => {
  const drawn = new Set(['c_a', 'c_b', 'c_c'])
  const lines = linesOf(
    [
      { from_id: 'c_b', to_id: 'c_a', travel: null, direction: '북' },
      {
        from_id: 'c_a',
        to_id: 'c_b',
        travel: { value: 2, unit: 'hour', mode: '말' },
        direction: null,
      },
      { from_id: 'c_a', to_id: 'c_gone', travel: null, direction: null },
      { from_id: 'c_c', to_id: 'c_c', travel: null, direction: null },
    ],
    drawn,
  )
  // c_a lies north of c_b, so from a to b is south.
  expect(lines).toEqual([
    {
      id: 'c_a|c_b',
      a: 'c_a',
      b: 'c_b',
      travel: { value: 2, unit: 'hour', mode: '말' },
      dir: { x: 0, y: 1 },
    },
  ])
})

test('saved places stay put; a new region starts the written way from its neighbour', () => {
  const lines = linesOf(
    [{ from_id: 'c_port', to_id: 'c_new', travel: null, direction: '동' }],
    new Set(['c_port', 'c_new']),
  )
  const points = layout(['c_port', 'c_new'], new Map([['c_port', { x: 100, y: 50 }]]), lines, [])
  expect(points.get('c_port')).toEqual({ x: 100, y: 50 })
  const fresh = points.get('c_new') ?? { x: 0, y: 0 }
  expect(fresh.x).toBeGreaterThan(200)
  expect(Math.abs(fresh.y - 50)).toBeLessThan(60)
  // Same data, same picture.
  expect(layout(['c_port', 'c_new'], new Map([['c_port', { x: 100, y: 50 }]]), lines, [])).toEqual(
    points,
  )
})

test('areas wrap their children, nest, and survive a parent cycle', () => {
  const children = new Map([
    ['c_kingdom', ['c_north']],
    ['c_north', ['c_port', 'c_dock']],
  ])
  const points = new Map([
    ['c_port', { x: 0, y: 0 }],
    ['c_dock', { x: 200, y: 100 }],
  ])
  const areas = areasOf(children, points)
  const north = areas.get('c_north')
  const kingdom = areas.get('c_kingdom')
  if (!north || !kingdom) throw new Error('missing area')
  expect(north.x).toBeLessThan(-70)
  expect(north.x + north.width).toBeGreaterThan(270)
  expect(kingdom.x).toBeLessThan(north.x)
  expect(kingdom.y).toBeLessThan(north.y)
  const cycle = areasOf(
    new Map([
      ['c_a', ['c_b']],
      ['c_b', ['c_a']],
    ]),
    new Map(),
  )
  expect(cycle.size).toBe(0)
})
