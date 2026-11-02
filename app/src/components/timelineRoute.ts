// How the timeline's arrows run (§8 S1-3): along and across the lanes with rounded corners,
// never through another episode; when the direct way is blocked, through the gaps between the
// columns and rows, where no node ever lies.

export type Point = { x: number; y: number }
/** An episode's node: its centre and size. */
export type NodeBox = { x: number; y: number; width: number; height: number }
/** Whether a straight (across or down) piece of an arrow from a to b touches another node. */
export type Blocked = (a: Point, b: Point) => boolean
/** The free space between two columns and between two rows. */
export type Gaps = { column: number; row: number }

// Corner radius of a bend.
const RADIUS = 7
// A cause arrow runs this far below the order arrow's height, so their heads never meet.
const CAUSE_DROP = 11

/** A path through points, each inner corner rounded; repeated and in-line points dropped. */
export function rounded(points: Point[]): string {
  const distinct = points.filter((point, i) => {
    const prev = points[i - 1]
    return !prev || prev.x !== point.x || prev.y !== point.y
  })
  const kept = distinct.filter((point, i) => {
    const prev = distinct[i - 1]
    const next = distinct[i + 1]
    // In line with both neighbours: no corner here.
    return !(
      prev &&
      next &&
      (prev.x - point.x) * (next.y - point.y) === (prev.y - point.y) * (next.x - point.x)
    )
  })
  const out: string[] = []
  kept.forEach((point, i) => {
    const prev = kept[i - 1]
    const next = kept[i + 1]
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

/** Whether a route touches no other node along any of its pieces. */
function clear(route: Point[], blocked: Blocked): boolean {
  return route.every((point, i) => {
    const next = route[i + 1]
    return !next || !blocked(point, next)
  })
}

/** The points an arrow runs through from one node into another.
 *
 * Both kinds come into the side of `to` facing `from`: order (what comes next) at its middle,
 * cause (what led to it) a little lower, so their heads never meet. The direct way: straight
 * across in one row; to another row, out of `from`'s top or bottom (order by its quarter
 * toward `to`, cause just off the middle the other way, clear of the episode's own markers),
 * then across into `to`; between two nodes at the same time, straight up or down (order by the
 * left quarter, cause just right of the middle). If that touches another node, the arrow goes
 * round through the gaps, where no node lies: out of `from`'s side into the column gap, along
 * the gap between the rows next to `to`, down (or up) the column gap before it and in. Order
 * and cause keep apart there too: in the gaps a few pixels apart, the cause along the row gap
 * on `to`'s far side. */
export function routeOf(
  from: NodeBox,
  to: NodeBox,
  kind: 'order' | 'cause',
  blocked: Blocked,
  gaps: Gaps,
): Point[] {
  const sameColumn = Math.abs(to.x - from.x) < 1
  const side = sameColumn || to.x > from.x ? 1 : -1
  const down = to.y > from.y + 0.5 ? 1 : to.y < from.y - 0.5 ? -1 : 0
  const cause = kind === 'cause'
  const drop = cause ? CAUSE_DROP : 0
  const edgeX = (box: NodeBox, sign: number) => box.x + (sign * box.width) / 2
  const edgeY = (box: NodeBox, sign: number) => box.y + (sign * box.height) / 2

  let direct: Point[]
  if (sameColumn) {
    const x = cause ? from.x + from.width / 8 : from.x - from.width / 4
    direct = [
      { x, y: edgeY(from, down) },
      { x, y: edgeY(to, -down) },
    ]
  } else if (down === 0) {
    direct = [
      { x: edgeX(from, side), y: from.y + drop },
      { x: edgeX(to, -side), y: to.y + drop },
    ]
  } else {
    const x = cause ? from.x - (side * from.width) / 8 : from.x + (side * from.width) / 4
    direct = [
      { x, y: edgeY(from, down) },
      { x, y: to.y + drop },
      { x: edgeX(to, -side), y: to.y + drop },
    ]
  }
  if (clear(direct, blocked)) return direct

  // Round through the gaps. Between two nodes at the same time it goes out of the right side
  // and comes back into `to`'s right side, an order above the middle there (its middle is
  // where `to`'s own next arrow leaves), a cause below.
  const level = sameColumn && !cause ? -CAUSE_DROP : drop
  const shift = cause ? (side * gaps.column) / 4 : 0
  const out = edgeX(from, side)
  const away = out + (side * gaps.column) / 2 + shift
  const into = sameColumn ? edgeX(to, 1) : edgeX(to, -side)
  const before = sameColumn ? away : into - (side * gaps.column) / 2 - shift
  // The gap between the rows on `to`'s side toward `from` (above it when in one row); a cause
  // takes the one on its far side.
  const toward = (down === 0 ? 1 : down) * (cause ? -1 : 1)
  const lane = edgeY(to, -toward) - (toward * gaps.row) / 2
  return [
    { x: out, y: from.y + level },
    { x: away, y: from.y + level },
    { x: away, y: lane },
    { x: before, y: lane },
    { x: before, y: to.y + level },
    { x: into, y: to.y + level },
  ]
}
