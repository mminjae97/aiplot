import { strings } from '../strings'
import type { TensionPoint } from './dualTimelineLayout'

type Props = {
  points: readonly TensionPoint[]
  columns: number
  /** Column boundaries where a chapter ends (the last chapter's end is not one). */
  cuts: readonly number[]
}

const MAX_TENSION = 5
const RANGE = MAX_TENSION - 1
const GRID = [0, 1, 2, 3, 4]

/** The tension curve over the narration's columns, with dashed chapter cuts (§9). The svg is
 * stretched to the columns' width, so its lines keep their thickness by non-scaling-stroke and
 * the points are drawn in HTML to stay round. */
export function TensionChart({ points, columns, cuts }: Props) {
  const line = points.map((point) => `${String(point.x)},${String(MAX_TENSION - point.tension)}`)
  return (
    <div
      className="tension-chart"
      role="img"
      aria-label={strings.direction.tensionLabel(points.map((point) => point.tension))}
    >
      <svg viewBox={`0 0 ${String(columns)} ${String(RANGE)}`} preserveAspectRatio="none">
        {GRID.map((y) => (
          <line key={y} className="tension-grid" x1={0} x2={columns} y1={y} y2={y} />
        ))}
        {cuts.map((x) => (
          <line key={x} className="tension-cut" x1={x} x2={x} y1={0} y2={RANGE} />
        ))}
        {line.length > 1 && <polyline className="tension-line" points={line.join(' ')} />}
      </svg>
      {points.map((point) => (
        <span
          key={point.x}
          className="tension-point"
          data-estimated={point.estimated ? '' : undefined}
          style={{
            left: `${String((point.x / columns) * 100)}%`,
            top: `${String(((MAX_TENSION - point.tension) / RANGE) * 100)}%`,
          }}
        />
      ))}
    </div>
  )
}
