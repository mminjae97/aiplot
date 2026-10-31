import { strings } from '../strings'
import type { EpisodeCard, MilestoneFulfilment } from '../types'
import type { Timeline } from './storyLayout'

// Grid sizes: the lane names on the left, a column per story beat, a lane per region.
const GUTTER = 136
const COLUMN = 176
const HEAD = 112
const LANE = 96
const NODE_WIDTH = 144
const NODE_HEIGHT = 58

/** Milestone colours: muted inks that keep white numerals readable; every node also says its
 * milestone's number, so colour is never the only sign (§5). */
const INKS = ['#8b3a32', '#2f5d4a', '#2f4a73', '#7a5a1e', '#5a4170', '#3c6470', '#6b4a2e']
export const inkOf = (index: number) => INKS[index % INKS.length] ?? '#5a4a3a'

const cx = (column: number) => GUTTER + column * COLUMN + COLUMN / 2
const cy = (lane: number) => HEAD + lane * LANE + LANE / 2

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
  const height = HEAD + Math.max(timeline.lanes.length, 1) * LANE + 24
  const at = new Map(timeline.nodes.map((node) => [node.episodeId, node]))

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
        {milestones.map((milestone, index) => {
          const column = timeline.milestoneColumns.get(index)
          if (column === undefined) return null
          return (
            <span
              key={milestone.id}
              className="timeline-milestone"
              style={{ left: cx(column), background: inkOf(index) }}
              title={milestone.text}
            >
              {index + 1}
              <span className="timeline-milestone-text">{milestone.text}</span>
            </span>
          )
        })}

        {timeline.lanes.map((lane, index) => (
          <div
            key={lane.id ?? 'nowhere'}
            className="timeline-lane"
            style={{ top: HEAD + index * LANE, height: LANE }}
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
            const forward = cx(to.column) >= cx(from.column)
            const x1 = cx(from.column) + (forward ? NODE_WIDTH / 2 : -NODE_WIDTH / 2)
            const x2 = cx(to.column) + (forward ? -NODE_WIDTH / 2 : NODE_WIDTH / 2)
            const y1 = cy(from.lane)
            const y2 = cy(to.lane)
            const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1)
            return (
              <path
                key={`${arrow.from}|${arrow.to}|${arrow.kind}`}
                className={`timeline-arrow timeline-arrow-${arrow.kind}`}
                d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                markerEnd={`url(#arrow-${arrow.kind})`}
              />
            )
          })}
        </svg>

        {timeline.markers.map((marker) => (
          <span
            key={`${marker.episodeId}|${String(marker.lane)}`}
            className="timeline-marker"
            style={{ left: cx(marker.column), top: cy(marker.lane) }}
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
                top: cy(node.lane) - NODE_HEIGHT / 2,
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
