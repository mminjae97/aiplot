import { expect, test } from 'vitest'
import { type NodeBox, type Point, rounded, routeOf } from '../src/components/timelineRoute'

// The timeline's grid (EpisodeTimeline): 124px columns of 104px nodes, 40px rows of 32px
// nodes, a lane per region 50px tall when it has one row.
const GAPS = { column: 20, row: 8 }
const node = (column: number, lane: number, row = 0): NodeBox => ({
  x: 150 + 124 * column,
  y: 101 + 50 * lane + 40 * row,
  width: 104,
  height: 32,
})

const touches = (box: NodeBox, a: Point, b: Point) =>
  Math.max(a.x, b.x) >= box.x - box.width / 2 - 3 &&
  Math.min(a.x, b.x) <= box.x + box.width / 2 + 3 &&
  Math.max(a.y, b.y) >= box.y - box.height / 2 - 3 &&
  Math.min(a.y, b.y) <= box.y + box.height / 2 + 3

/** Routes an arrow among `others` (the other nodes on the timeline) and checks no piece of it
 * touches one. */
function route(from: NodeBox, to: NodeBox, kind: 'order' | 'cause', others: NodeBox[] = []) {
  const blocked = (a: Point, b: Point) => others.some((box) => touches(box, a, b))
  const points = routeOf(from, to, kind, blocked, GAPS)
  points.slice(1).forEach((point, i) => {
    const prev = points[i] ?? point
    // Every piece runs straight across or straight down.
    expect(prev.x === point.x || prev.y === point.y).toBe(true)
    for (const box of others) expect(touches(box, prev, point)).toBe(false)
  })
  return points
}

test('order in one row runs side to side; a cause runs lower, so the heads never meet', () => {
  expect(route(node(0, 0), node(1, 0), 'order')).toEqual([
    { x: 202, y: 101 },
    { x: 222, y: 101 },
  ])
  expect(route(node(0, 0), node(1, 0), 'cause')).toEqual([
    { x: 202, y: 112 },
    { x: 222, y: 112 },
  ])
})

test('order to another row leaves down, turns, and comes in from the side', () => {
  expect(route(node(0, 0), node(1, 2), 'order')).toEqual([
    { x: 176, y: 117 },
    { x: 176, y: 201 },
    { x: 222, y: 201 },
  ])
  // Going back up and back in time: out of the top by the left quarter, into the right side.
  expect(route(node(2, 2), node(1, 0), 'order')).toEqual([
    { x: 372, y: 185 },
    { x: 372, y: 101 },
    { x: 326, y: 101 },
  ])
})

test('a cause skipping a column runs clear of the order arrow and the node between', () => {
  // A → B is order in one row; A causes C a row down, two columns on.
  const points = route(node(0, 0), node(2, 1), 'cause', [node(1, 0)])
  expect(points.at(-1)).toEqual({ x: 346, y: 162 })
})

test('an arrow past a node at the same time as either end goes round through the gaps', () => {
  // B is at the same time as A, in the lane between A's and C's.
  const order = route(node(0, 0), node(1, 2), 'order', [node(0, 1)])
  expect(order.at(-1)).toEqual({ x: 222, y: 201 })
  // B is at the same time as C.
  const cause = route(node(0, 0), node(1, 2), 'cause', [node(1, 1)])
  expect(cause.at(-1)).toEqual({ x: 222, y: 212 })
})

test('an order link skipping columns in one row goes round the nodes between', () => {
  const points = route(node(0, 0), node(3, 0), 'order', [node(1, 0), node(2, 0)])
  expect(points.at(-1)).toEqual({ x: 470, y: 101 })
  // Along the gap above the row, never through it.
  expect(Math.min(...points.map((point) => point.y))).toBeLessThan(85)
})

test('nodes at the same time: order and cause run apart, round a node between them', () => {
  const order = route(node(0, 0), node(0, 1), 'order')
  const cause = route(node(0, 0), node(0, 1), 'cause')
  expect(order[0]?.x).toBeLessThan(150)
  expect(cause[0]?.x).toBeGreaterThan(150)
  // A, B and C at one time in three lanes; A → C goes round B.
  route(node(0, 0), node(0, 2), 'order', [node(0, 1)])
})

test('a cause in a stacked row stays out of the row above', () => {
  route(node(0, 0, 1), node(1, 0, 1), 'cause', [node(0, 0, 0), node(1, 0, 0)])
})

test('corners are rounded, ends are exact, in-line points dropped', () => {
  const d = rounded([
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 0, y: 100 },
    { x: 50, y: 100 },
    { x: 50, y: 100 },
  ])
  expect(d).toBe('M 0 0 L 0 93 Q 0 100 7 100 L 50 100')
})

/** Whether two routes share a stretch of line (lying on one another, not just crossing). */
function overlap(a: Point[], b: Point[]): boolean {
  const pieces = (route: Point[]) =>
    route.slice(1).map((point, i) => [route[i] ?? point, point] as const)
  return pieces(a).some(([p, q]) =>
    pieces(b).some(([r, t]) => {
      if (p.x === q.x && r.x === t.x && p.x === r.x)
        return (
          Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y)) -
            Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y)) >
          1
        )
      if (p.y === q.y && r.y === t.y && p.y === r.y)
        return (
          Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x)) -
            Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x)) >
          1
        )
      return false
    }),
  )
}

test('an order and a cause going round the same node never lie on one another', () => {
  const others = [node(0, 1)]
  const order = route(node(0, 0), node(1, 2), 'order', others)
  const cause = route(node(0, 0), node(1, 2), 'cause', others)
  expect(overlap(order, cause)).toBe(false)
})

test("a cause to an episode at the same time leaves apart from the node's order arrow", () => {
  // A's next is P a lane down and a column on; A also causes M, two lanes down, at its time.
  const order = route(node(0, 0), node(1, 1), 'order')
  const cause = route(node(0, 0), node(0, 2), 'cause', [])
  expect(overlap(order, cause)).toBe(false)
})

test("an order going round between episodes at the same time keeps off the next one's arrow", () => {
  // A, X and C at one time; A → C goes round X, and C → D goes on in C's row.
  const around = route(node(0, 0), node(0, 2), 'order', [node(0, 1)])
  const onward = route(node(0, 2), node(1, 2), 'order')
  expect(overlap(around, onward)).toBe(false)
})

test('order and cause heads into one side stay apart', () => {
  const order = route(node(0, 0), node(1, 0), 'order')
  const cause = route(node(0, 0), node(1, 0), 'cause')
  // Heads are 9.6px across: their middles at least that far apart.
  expect(Math.abs((cause.at(-1)?.y ?? 0) - (order.at(-1)?.y ?? 0))).toBeGreaterThanOrEqual(9.6)
})
