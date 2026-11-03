import { expect, test } from 'vitest'
import {
  adjacentOf,
  areasOf,
  directionOf,
  layout,
  lengthOf,
  linesOf,
  NODE_HEIGHT,
  NODE_WIDTH,
  throughAreas,
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

test("a card's back lists each linked region once, from its own row when it has one", () => {
  const names = new Map([
    ['a', '수도'],
    ['b', '항구'],
    ['c', '숲'],
  ])
  const adjacent = adjacentOf(
    'a',
    [
      // Stored per card: the other's row comes first here.
      { from_id: 'b', to_id: 'a', travel: { value: 2, unit: 'day', mode: '배' }, direction: '서' },
      { from_id: 'a', to_id: 'b', travel: null, direction: '동' },
      { from_id: 'c', to_id: 'a', travel: { value: 3, unit: 'hour', mode: null }, direction: '북' },
      { from_id: 'c', to_id: 'b', travel: null, direction: null },
      { from_id: 'a', to_id: 'x', travel: null, direction: null },
    ],
    names,
  )
  expect(adjacent).toEqual([
    { id: 'b', name: '항구', travel: '2일 · 배', way: '동' },
    // Only the other's row: its journey, but not its way (that is from c).
    { id: 'c', name: '숲', travel: '3시간', way: null },
  ])
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

test('a line to an area pulls on the regions inside it, sharing its pull', () => {
  const lines = linesOf(
    [
      {
        from_id: 'c_capital',
        to_id: 'c_north',
        travel: { value: 2, unit: 'day', mode: '말' },
        direction: '북',
      },
    ],
    new Set(['c_capital', 'c_north']),
  )
  const inside: Record<string, string[]> = { c_capital: ['c_palace', 'c_market'] }
  const through = throughAreas(lines, (id) => inside[id] ?? [id])
  expect(through.map((line) => [line.a, line.b, line.weight])).toEqual([
    ['c_palace', 'c_north', 0.5],
    ['c_market', 'c_north', 0.5],
  ])
  // The way still points from the capital's regions up to the north.
  expect(through[0]?.dir).toEqual({ x: 0, y: -1 })
})

test('regions linked only to an area settle around it, the way the notes point', () => {
  // The capital is drawn as an area around its palace; the others link to the capital.
  const ids = ['c_capital', 'c_palace', 'c_north', 'c_south', 'c_east', 'c_west']
  const rows = [
    ['c_north', '북'],
    ['c_south', '남'],
    ['c_east', '동'],
    ['c_west', '서'],
  ].map(([to, direction]) => ({
    from_id: 'c_capital',
    to_id: to ?? '',
    travel: { value: 3, unit: 'day' as const, mode: '말' },
    direction: direction ?? null,
  }))
  const lines = throughAreas(linesOf(rows, new Set(ids)), (id) =>
    id === 'c_capital' ? ['c_palace'] : [id],
  )
  const drawn = ids.filter((id) => id !== 'c_capital')
  const at = layout(drawn, new Map(), lines, [['c_palace']])
  const point = (id: string) => at.get(id) ?? { x: NaN, y: NaN }
  const palace = point('c_palace')
  expect(point('c_north').y).toBeLessThan(palace.y - 150)
  expect(point('c_south').y).toBeGreaterThan(palace.y + 150)
  expect(point('c_east').x).toBeGreaterThan(palace.x + 150)
  expect(point('c_west').x).toBeLessThan(palace.x - 150)
  const xs = drawn.map((id) => point(id).x)
  const ys = drawn.map((id) => point(id).y)
  const width = Math.max(...xs) - Math.min(...xs) + NODE_WIDTH
  const height = Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT
  expect(width / height).toBeGreaterThan(0.8)
  expect(width / height).toBeLessThan(1.5)
})
