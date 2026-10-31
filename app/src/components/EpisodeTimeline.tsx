import { strings } from '../strings'
import type { EpisodeCard, MilestoneFulfilment } from '../types'
import type { Timeline } from './storyLayout'

// Grid sizes: the lane names on the left, a column per story beat, a lane per region.
const GUTTER = 136
const COLUMN = 176
const HEAD = 112
// A lane holds one row per episode stacked in its busiest cell, plus a margin.
const ROW = 72
const LANE_PAD = 24
const NODE_WIDTH = 144
const NODE_HEIGHT = 58

/** Milestone colours: muted inks that keep white numerals readable; every node also says its
 * milestone's number, so colour is never the only sign (§5). */
const INKS = ['#8b3a32', '#2f5d4a', '#2f4a73', '#7a5a1e', '#5a4170', '#3c6470', '#6b4a2e']
export const inkOf = (index: number) => INKS[index % INKS.length] ?? '#5a4a3a'

const cx = (column: number) => GUTTER + column * COLUMN + COLUMN / 2

type Props = {
  timeline: Timeline
  episodes: ReadonlyMap<string, EpisodeCard>
  milestones: MilestoneFulfilment[]
  selectedPart: string | null
  onSelectPart: (partId: string) => void
  onPick: (episodeId: string, origin: DOMRect | null) => void
}

/** S1-3 timeline (§8): story order across, split by part with titles; the main line on top
 * with the milestones over their parts; a lane per region; episodes as nodes in their main
 * region's lane, small markers in the others; arrows for order (solid) and cause (dashed). */
export function EpisodeTimeline({
  timeline,
  episodes,
  milestones,
  selectedPart,
  onSelectPart,
  onPick,
}: Props) {
  const width = GUTTER + Math.max(timeline.columns, 1) * COLUMN + 24
  // Lane tops: each lane as tall as its stack.
  const tops: number[] = []
  let bottom = HEAD
  for (const lane of timeline.lanes) {
    tops.push(bottom)
    bottom += lane.rows * ROW + LANE_PAD
  }
  const height = Math.max(bottom, HEAD + ROW + LANE_PAD) + 24
  const cy = (lane: number, row: number) =>
    (tops[lane] ?? HEAD) + LANE_PAD / 2 + row * ROW + ROW / 2
  const at = new Map(timeline.nodes.map((node) => [node.episodeId, node]))
  // Milestones sharing a column sit side by side, their texts joined under them.
  const byColumn = new Map<number, number[]>()
  milestones.forEach((_, index) => {
    const column = timeline.milestoneColumns.get(index)
    if (column !== undefined) byColumn.set(column, [...(byColumn.get(column) ?? []), index])
  })

  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ width, height }}>
        {timeline.spans.map((span, index) => (
          <div
            key={span.partId}
            className="timeline-part"
            data-even={index % 2 === 0 || undefined}
            data-selected={span.partId === selectedPart || undefined}
            style={{
              left: GUTTER + span.first * COLUMN,
              width: (span.last - span.first + 1) * COLUMN,
              top: HEAD - 34,
              height: height - HEAD + 34,
            }}
          >
            <button
              type="button"
              className="timeline-part-name"
              aria-pressed={span.partId === selectedPart}
              onClick={() => {
                onSelectPart(span.partId)
              }}
            >
              {span.label}
            </button>
          </div>
        ))}

        {/* The main line, with each milestone over the part (or first episode) that has it. */}
        <div className="timeline-main" style={{ width: width - GUTTER - 24, left: GUTTER }} />
        <span className="timeline-main-name">{strings.drawer.kind.main_story}</span>
        {[...byColumn].map(([column, indexes]) => (
          <div
            key={column}
            className="timeline-milestones"
            style={{ left: cx(column) }}
            title={indexes.map((index) => milestones[index]?.text ?? '').join(' · ')}
          >
            <span className="timeline-milestone-dots">
              {indexes.map((index) => (
                <span
                  key={index}
                  className="timeline-milestone"
                  style={{ background: inkOf(index) }}
                >
                  {index + 1}
                </span>
              ))}
            </span>
            <span className="timeline-milestone-text">
              {indexes.map((index) => milestones[index]?.text ?? '').join(' · ')}
            </span>
          </div>
        ))}

        {timeline.lanes.map((lane, index) => (
          <div
            key={lane.id ?? 'nowhere'}
            className="timeline-lane"
            style={{ top: tops[index], height: lane.rows * ROW + LANE_PAD }}
          >
            <span className="timeline-lane-name">{lane.label}</span>
          </div>
        ))}

        <svg className="timeline-arrows" width={width} height={height} aria-hidden="true">
          <defs>
            <marker
              id="arrow-order"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="timeline-head-order" />
            </marker>
            <marker
              id="arrow-cause"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="timeline-head-cause" />
            </marker>
          </defs>
          {timeline.arrows.map((arrow) => {
            const from = at.get(arrow.from)
            const to = at.get(arrow.to)
            if (!from || !to) return null
            const y1 = cy(from.lane, from.row)
            const y2 = cy(to.lane, to.row)
            let d: string
            if (from.column === to.column) {
              // Same column (simultaneous): a short bow out to the right, edge to edge.
              const x = cx(from.column) + NODE_WIDTH / 2
              d = `M ${String(x)} ${String(y1)} C ${String(x + 28)} ${String(y1)}, ${String(x + 28)} ${String(y2)}, ${String(x)} ${String(y2)}`
            } else {
              const forward = to.column > from.column
              const x1 = cx(from.column) + (forward ? NODE_WIDTH / 2 : -NODE_WIDTH / 2)
              const x2 = cx(to.column) + (forward ? -NODE_WIDTH / 2 : NODE_WIDTH / 2)
              const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1)
              d = `M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`
            }
            return (
              <path
                key={`${arrow.from}|${arrow.to}|${arrow.kind}`}
                className={`timeline-arrow timeline-arrow-${arrow.kind}`}
                d={d}
                markerEnd={`url(#arrow-${arrow.kind})`}
              />
            )
          })}
        </svg>

        {timeline.markers.map((marker) => (
          <span
            key={`${marker.episodeId}|${String(marker.lane)}`}
            className="timeline-marker"
            style={{ left: cx(marker.column), top: cy(marker.lane, marker.row) }}
            title={episodes.get(marker.episodeId)?.name ?? undefined}
          />
        ))}

        {timeline.nodes.map((node) => {
          const episode = episodes.get(node.episodeId)
          if (!episode) return null
          const milestone = timeline.milestoneOf.get(node.episodeId)
          const name = episode.name ?? strings.drawer.untitled
          return (
            <button
              key={node.episodeId}
              type="button"
              className="timeline-node"
              data-incomplete={episode.status === 'incomplete' || undefined}
              aria-label={strings.story.openEpisode(name)}
              style={{
                left: cx(node.column) - NODE_WIDTH / 2,
                top: cy(node.lane, node.row) - NODE_HEIGHT / 2,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                borderLeftColor: milestone === undefined ? undefined : inkOf(milestone),
              }}
              onClick={(event) => {
                onPick(node.episodeId, event.currentTarget.getBoundingClientRect())
              }}
            >
              <span className="timeline-node-name">{name}</span>
              {milestone !== undefined && (
                <span className="timeline-node-milestone" style={{ background: inkOf(milestone) }}>
                  {milestone + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
