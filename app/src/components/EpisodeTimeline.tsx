import { type PointerEvent, type RefObject, useEffect, useRef } from 'react'
import { strings } from '../strings'
import type { EpisodeCard, MilestoneFulfilment } from '../types'
import type { Placed, Timeline } from './storyLayout'
import { type NodeBox, type Point, rounded, routeOf } from './timelineRoute'

// Grid sizes, kept tight so the open book shows as much of the story as it can: the lane
// names on the left, a column per story beat, a lane per region.
const GUTTER = 92
const COLUMN = 124
// The main line with its milestones, then the part titles, above the first lane.
const HEAD = 76
const PART_HEAD = 22
// A lane holds one row per episode stacked in its busiest cell, plus a margin.
const ROW = 40
const LANE_PAD = 10
const NODE_WIDTH = 104
const NODE_HEIGHT = 32
// Free space between two columns' nodes and two rows' (arrows go round through it).
const GAPS = { column: COLUMN - NODE_WIDTH, row: ROW - NODE_HEIGHT }

/** Milestone colours: muted inks that keep white numerals readable; every node also says its
 * milestone's number, so colour is never the only sign (§5). */
const INKS = ['#8b3a32', '#2f5d4a', '#2f4a73', '#7a5a1e', '#5a4170', '#3c6470', '#6b4a2e']
export const inkOf = (index: number) => INKS[index % INKS.length] ?? '#5a4a3a'

const cx = (column: number) => GUTTER + column * COLUMN + COLUMN / 2

// A wheel step given in lines (rather than pixels) moves about this far.
const LINE_PX = 16

/** The wheel runs the story across: up shows what comes before, down what comes after. */
function useWheelAcross(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const onWheel = (event: WheelEvent) => {
      // Ctrl+wheel stays the browser's zoom; sideways wheels and touchpads scroll as they are.
      if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return
      if (box.scrollWidth <= box.clientWidth) return
      event.preventDefault()
      box.scrollLeft +=
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_PX : event.deltaY
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      box.removeEventListener('wheel', onWheel)
    }
  }, [ref])
}

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
 * region's lane, small markers in the others; arrows for order (solid) and cause (dashed).
 * The wheel moves it along the story and the paper can be dragged. */
export function EpisodeTimeline({
  timeline,
  episodes,
  milestones,
  selectedPart,
  onSelectPart,
  onPick,
}: Props) {
  const width = GUTTER + Math.max(timeline.columns, 1) * COLUMN + 12
  // Lane tops: each lane as tall as its stack.
  const tops: number[] = []
  let bottom = HEAD
  for (const lane of timeline.lanes) {
    tops.push(bottom)
    bottom += lane.rows * ROW + LANE_PAD
  }
  const height = Math.max(bottom, HEAD + ROW + LANE_PAD) + 8
  const cy = (lane: number, row: number) =>
    (tops[lane] ?? HEAD) + LANE_PAD / 2 + row * ROW + ROW / 2
  const at = new Map(timeline.nodes.map((node) => [node.episodeId, node]))
  const boxOf = (node: Placed): NodeBox => ({
    x: cx(node.column),
    y: cy(node.lane, node.row),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  })
  const boxes = timeline.nodes.map(boxOf)
  const scrollRef = useRef<HTMLDivElement>(null)
  useWheelAcross(scrollRef)
  // Dragging the paper (not a node or a part's name) moves the view with the pointer.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    const box = event.currentTarget
    // On the scrollbars (past the box's client area): the browser scrolls by them.
    const at = box.getBoundingClientRect()
    if (
      event.clientX - at.left - box.clientLeft >= box.clientWidth ||
      event.clientY - at.top - box.clientTop >= box.clientHeight
    )
      return
    drag.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop }
    box.setPointerCapture(event.pointerId)
    // no text selection while dragging
    event.preventDefault()
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    event.currentTarget.scrollLeft = from.left - (event.clientX - from.x)
    event.currentTarget.scrollTop = from.top - (event.clientY - from.y)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  // Milestones sharing a column sit side by side, their texts joined under them.
  const byColumn = new Map<number, number[]>()
  milestones.forEach((_, index) => {
    const column = timeline.milestoneColumns.get(index)
    if (column !== undefined) byColumn.set(column, [...(byColumn.get(column) ?? []), index])
  })

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
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
              top: HEAD - PART_HEAD,
              height: height - HEAD + PART_HEAD,
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
        <div className="timeline-main" style={{ width: width - GUTTER - 12, left: GUTTER }} />
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
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="timeline-head-order" />
            </marker>
            <marker
              id="arrow-cause"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="timeline-head-cause" />
            </marker>
          </defs>
          {timeline.arrows.map((arrow) => {
            const from = at.get(arrow.from)
            const to = at.get(arrow.to)
            if (!from || !to) return null
            const others = boxes.filter(
              (_, i) => timeline.nodes[i] !== from && timeline.nodes[i] !== to,
            )
            // A straight piece touches a node it passes within 3px of.
            const blocked = (a: Point, b: Point) =>
              others.some(
                (box) =>
                  Math.max(a.x, b.x) >= box.x - box.width / 2 - 3 &&
                  Math.min(a.x, b.x) <= box.x + box.width / 2 + 3 &&
                  Math.max(a.y, b.y) >= box.y - box.height / 2 - 3 &&
                  Math.min(a.y, b.y) <= box.y + box.height / 2 + 3,
              )
            return (
              <path
                key={`${arrow.from}|${arrow.to}|${arrow.kind}`}
                className={`timeline-arrow timeline-arrow-${arrow.kind}`}
                d={rounded(routeOf(boxOf(from), boxOf(to), arrow.kind, blocked, GAPS))}
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
