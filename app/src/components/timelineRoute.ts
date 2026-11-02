// How the timeline's arrows run (§8 S1-3): along and across the lanes with rounded corners,
// never squeezed into the narrow gap between two columns unless the way round is taken.

export type Point = { x: number; y: number }
/** An episode's node: its centre and size. */
export type NodeBox = { x: number; y: number; width: number; height: number }

// Corner radius of a bend.
const RADIUS = 7
// How far above two nodes in one row a cause arrow bows over.
const BOW = 16

/** A path through points, each inner corner rounded. */
export function rounded(points: Point[]): string {
  const out: string[] = []
  points.forEach((point, i) => {
    const prev = points[i - 1]
    const next = points[i + 1]
    if (!prev) {
      out.push(`M ${String(point.x)} ${String(point.y)}`)
      return
    }
    if (!next) {
      out.push(`L ${String(point.x)} ${String(point.y)}`)
      return
    }
    const r = Math.min(
      RADIUS,
      Math.hypot(point.x - prev.x, point.y - prev.y) / 2,
      Math.hypot(next.x - point.x, next.y - point.y) / 2,
    )
    const toward = (from: Point, to: Point) => {
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
      return {
        x: from.x + ((to.x - from.x) / length) * r,
        y: from.y + ((to.y - from.y) / length) * r,
      }
    }
    const a = toward(point, prev)
    const b = toward(point, next)
    out.push(
      `L ${String(a.x)} ${String(a.y)} Q ${String(point.x)} ${String(point.y)} ${String(b.x)} ${String(b.y)}`,
    )
  })
  return out.join(' ')
}

/** The points an arrow runs through from one node to another.
 *
 * Order (what comes next): out of the side of `from` when both lie in one row; otherwise down
 * (or up) out of `from`'s right quarter, then along into the near side of `to`. If a node lies
 * where it would turn (`blocked`), it goes out of the side instead, across in the gap just before
 * `to`, then into it. Nodes in one column (at the same time): straight up or down the middle.
 *
 * Cause (what led to it): out of the side of `from`, then down (or up) into `to`'s left quarter
 * from above (or below), so its head never meets an order arrow's; in one row it bows over
 * the top from `from`'s top to `to`'s. */
export function routeOf(
  from: NodeBox,
  to: NodeBox,
  kind: 'order' | 'cause',
  blocked: (at: Point) => boolean,
): Point[] {
  const forward = to.x >= from.x
  const side = forward ? 1 : -1
  const down = to.y > from.y ? 1 : -1
  const quarter = (box: NodeBox, sign: number) => box.x + (sign * box.width) / 4
  const edgeX = (box: NodeBox, sign: number) => box.x + (sign * box.width) / 2
  const edgeY = (box: NodeBox, sign: number) => box.y + (sign * box.height) / 2

  if (Math.abs(to.x - from.x) < 1) {
    // One column: straight between the facing edges, down the middle (an order arrow going on
    // from either leaves by its right quarter).
    const x = from.x
    return [
      { x, y: edgeY(from, down) },
      { x, y: edgeY(to, -down) },
    ]
  }

  if (Math.abs(to.y - from.y) < 1) {
    if (kind === 'order')
      return [
        { x: edgeX(from, side), y: from.y },
        { x: edgeX(to, -side), y: to.y },
      ]
    // Cause in one row: over the top, clear of the order arrow between them.
    const top = Math.min(edgeY(from, -1), edgeY(to, -1)) - BOW
    return [
      { x: quarter(from, side), y: edgeY(from, -1) },
      { x: quarter(from, side), y: top },
      { x: quarter(to, -side), y: top },
      { x: quarter(to, -side), y: edgeY(to, -1) },
    ]
  }

  if (kind === 'order') {
    const x = quarter(from, side)
    const corner = { x, y: to.y }
    if (!blocked(corner))
      return [{ x, y: edgeY(from, down) }, corner, { x: edgeX(to, -side), y: to.y }]
    // Round the node in the way: across in the gap just before `to`.
    const gap = edgeX(to, -side) - side * 6
    return [
      { x: edgeX(from, side), y: from.y },
      { x: gap, y: from.y },
      { x: gap, y: to.y },
      { x: edgeX(to, -side), y: to.y },
    ]
  }

  const x = quarter(to, -side)
  const corner = { x, y: from.y }
  if (!blocked(corner))
    return [{ x: edgeX(from, side), y: from.y }, corner, { x, y: edgeY(to, -down) }]
  // A node where it would turn: down (or up) out of `from` first, then along over `to`.
  const over = edgeY(to, -down) - down * 8
  return [
    { x: quarter(from, side), y: edgeY(from, down) },
    { x: quarter(from, side), y: over },
    { x, y: over },
    { x, y: edgeY(to, -down) },
  ]
}
