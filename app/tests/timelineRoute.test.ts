import { expect, test } from 'vitest'
import { rounded, routeOf } from '../src/components/timelineRoute'

const box = (x: number, y: number) => ({ x, y, width: 104, height: 32 })
const free = () => false

test('order in one row runs side to side', () => {
  expect(routeOf(box(100, 50), box(216, 50), 'order', free)).toEqual([
    { x: 152, y: 50 },
    { x: 164, y: 50 },
  ])
})

test('order to another row leaves down, turns, and comes in from the side', () => {
  expect(routeOf(box(100, 50), box(216, 250), 'order', free)).toEqual([
    { x: 126, y: 66 },
    { x: 126, y: 250 },
    { x: 164, y: 250 },
  ])
  // Going up leaves by the top.
  expect(routeOf(box(100, 250), box(216, 50), 'order', free)[0]).toEqual({ x: 126, y: 234 })
})

test('a node where the order arrow would turn sends it round through the gap before the next', () => {
  expect(routeOf(box(100, 50), box(216, 250), 'order', () => true)).toEqual([
    { x: 152, y: 50 },
    { x: 158, y: 50 },
    { x: 158, y: 250 },
    { x: 164, y: 250 },
  ])
})

test('nodes at the same time are joined straight down the middle', () => {
  expect(routeOf(box(100, 50), box(100, 250), 'order', free)).toEqual([
    { x: 100, y: 66 },
    { x: 100, y: 234 },
  ])
})

test('a cause comes in from above or below, never where an order arrow arrives', () => {
  expect(routeOf(box(100, 50), box(216, 250), 'cause', free)).toEqual([
    { x: 152, y: 50 },
    { x: 190, y: 50 },
    { x: 190, y: 234 },
  ])
  // In one row it bows over the top.
  const over = routeOf(box(100, 50), box(216, 50), 'cause', free)
  expect(over[0]).toEqual({ x: 126, y: 34 })
  expect(over.at(-1)).toEqual({ x: 190, y: 34 })
  expect(Math.min(...over.map((point) => point.y))).toBeLessThan(34)
})

test('corners are rounded, ends are exact', () => {
  const d = rounded([
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 50, y: 100 },
  ])
  expect(d.startsWith('M 0 0 L 0 93 Q 0 100 7 100')).toBe(true)
  expect(d.endsWith('L 50 100')).toBe(true)
})
