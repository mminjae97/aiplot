import { type CSSProperties, type PointerEvent, useRef, useState } from 'react'
import { strings } from '../strings'
import type { DirectionPlan, EpisodeCard, PlanScene } from '../types'
import {
  addCut,
  chapterSpans,
  layoutOf,
  MAX_CHAPTERS,
  moveCut,
  moveScene,
  narrationOrder,
  removeCut,
  reorderedScenes,
  sameLayout,
  storyOrder,
  tensionPoints,
} from './dualTimelineLayout'
import { TensionChart } from './TensionChart'

type Props = {
  plan: DirectionPlan
  structure: EpisodeCard['data']['structure']
  selected: number
  onSelect: (scene: number) => void
  /** The told order or cuts changed by dragging; null = read-only. */
  onLayout: ((layout: number[][]) => void) | null
}

type Grip = { kind: 'scene'; scene: number } | { kind: 'cut'; cut: number }
type Drag = Grip & { layout: number[][]; boundary: number }

// Less than this is a click.
const DRAG_START_PX = 4

/** The dual timeline (§9): the scenes in story order over the same scenes as told, each linked
 * to itself; those told out of order in the accent (and with a mark). Below, the chapters and
 * the tension curve in the told columns. The told scenes and the cuts between chapters can be
 * dragged; where they land is shown as a bar in the told row. */
export function DualTimeline({ plan, structure, selected, onSelect, onLayout }: Props) {
  const told = narrationOrder(plan)
  const story = storyOrder(plan)
  const reordered = reorderedScenes(plan)
  const spans = chapterSpans(plan)
  const columns = told.length
  const toldAt = new Map(told.map((scene, at) => [scene.scene, at]))
  const layout = layoutOf(plan)

  const toldRow = useRef<HTMLDivElement>(null)
  // Pressed on a grip, not moved far enough yet to be a drag.
  const [press, setPress] = useState<(Grip & { x: number }) | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The click that ends a drag must not also pick the scene.
  const [dragged, setDragged] = useState(false)

  /** The drag if it ended at pointer x: the layout, and the column boundary to show it at. */
  const dragAt = (grip: Grip, x: number): Drag => {
    const box = toldRow.current?.getBoundingClientRect()
    const at = box && box.width > 0 ? ((x - box.left) / box.width) * columns : 0
    if (grip.kind === 'cut') {
      const moved = moveCut(layout, grip.cut, Math.round(at))
      return { ...grip, layout: moved, boundary: moved.slice(0, grip.cut + 1).flat().length }
    }
    const column = Math.min(columns - 1, Math.max(0, Math.floor(at)))
    const after = at - column >= 0.5
    const target = told[column]?.scene ?? grip.scene
    return {
      ...grip,
      layout: moveScene(layout, grip.scene, target, after),
      boundary: column + (after ? 1 : 0),
    }
  }

  const gripHandlers = (grip: Grip) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      setDragged(false)
      if (onLayout === null || event.button !== 0) return
      setPress({ ...grip, x: event.clientX })
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (press === null) return
      if (drag === null && Math.abs(event.clientX - press.x) < DRAG_START_PX) return
      setDrag(dragAt(grip, event.clientX))
    },
    onPointerUp: () => {
      setPress(null)
      if (drag === null) return
      setDragged(true)
      setDrag(null)
      if (!sameLayout(drag.layout, layout)) onLayout?.(drag.layout)
    },
    onPointerCancel: () => {
      setPress(null)
      setDrag(null)
    },
  })
  const dropAt = drag?.boundary ?? null
  const leftOf = (boundary: number) => `${String((boundary / columns) * 100)}%`

  const node = (scene: PlanScene, toldRowNode: boolean) => {
    const moved = reordered.has(scene.scene)
    return (
      <button
        key={scene.scene}
        type="button"
        className="timeline-scene"
        data-status={scene.status}
        data-reordered={moved ? '' : undefined}
        data-dragging={
          toldRowNode && drag?.kind === 'scene' && drag.scene === scene.scene ? '' : undefined
        }
        aria-current={scene.scene === selected ? 'true' : undefined}
        aria-label={strings.direction.sceneLabel(
          scene.scene,
          scene.source,
          strings.direction.sceneStatus[scene.status],
          moved,
        )}
        title={scene.summary}
        {...(toldRowNode ? gripHandlers({ kind: 'scene', scene: scene.scene }) : {})}
        onClick={() => {
          if (dragged) setDragged(false)
          else onSelect(scene.scene)
        }}
      >
        <span className="timeline-scene-name">
          {strings.direction.sceneName(scene.scene)}
          {moved && <span aria-hidden="true"> {strings.direction.reorderedMark}</span>}
        </span>
        <small>{toldRowNode ? strings.direction.sceneShort[scene.status] : scene.source}</small>
      </button>
    )
  }

  return (
    <div
      className="dual-timeline"
      style={{ '--columns': columns } as CSSProperties}
      role="group"
      aria-label={strings.direction.timeline}
    >
      <span className="dual-label">{strings.direction.rowStory}</span>
      <div className="dual-row">{story.map((scene) => node(scene, false))}</div>

      <svg
        className="dual-links"
        viewBox={`0 0 ${String(columns)} 1`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {story.map((scene, at) => {
          const from = at + 0.5
          const to = (toldAt.get(scene.scene) ?? at) + 0.5
          return (
            <path
              key={scene.scene}
              d={`M ${String(from)} 0 C ${String(from)} 0.5, ${String(to)} 0.5, ${String(to)} 1`}
              data-reordered={reordered.has(scene.scene) ? '' : undefined}
              data-selected={scene.scene === selected ? '' : undefined}
            />
          )
        })}
      </svg>

      <span className="dual-label">{strings.direction.rowNarration}</span>
      <div ref={toldRow} className="dual-row">
        {told.map((scene) => node(scene, true))}
        {dropAt !== null && (
          <span className="dual-drop" style={{ left: leftOf(dropAt) }} aria-hidden="true" />
        )}
      </div>

      {onLayout !== null && (
        <div className="dual-grips">
          {spans.slice(1).map((span, cut) => (
            <div key={span.chapter} style={{ left: leftOf(span.start) }} className="dual-grip">
              <div
                className="dual-cut"
                role="separator"
                aria-orientation="vertical"
                aria-label={strings.direction.cutLabel(cut + 1)}
                data-dragging={drag?.kind === 'cut' && drag.cut === cut ? '' : undefined}
                {...gripHandlers({ kind: 'cut', cut })}
              >
                <span aria-hidden="true">⋮</span>
              </div>
              <button
                type="button"
                className="dual-remove-cut"
                aria-label={strings.direction.removeCut(cut + 1, cut + 2)}
                title={strings.direction.removeCut(cut + 1, cut + 2)}
                onClick={() => {
                  onLayout(removeCut(layout, cut))
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
          {spans.length < MAX_CHAPTERS &&
            told.slice(1).flatMap((scene, at) => {
              const boundary = at + 1
              if (spans.some((span) => span.start === boundary)) return []
              const before = told[at]?.scene ?? scene.scene
              return [
                <button
                  key={boundary}
                  type="button"
                  className="dual-add-cut"
                  style={{ left: leftOf(boundary) }}
                  aria-label={strings.direction.addCut(before)}
                  title={strings.direction.addCut(before)}
                  onClick={() => {
                    onLayout(addCut(layout, boundary))
                  }}
                >
                  <span aria-hidden="true">+</span>
                </button>,
              ]
            })}
        </div>
      )}

      <div className="dual-chapters">
        {spans.map((span) => (
          <span key={span.chapter} style={{ gridColumn: `span ${String(span.count)}` }}>
            {strings.direction.chapter(span.chapter, span.targetChars)}
          </span>
        ))}
      </div>

      <span className="dual-label">{strings.direction.rowTension}</span>
      <TensionChart
        points={tensionPoints(plan, structure)}
        columns={columns}
        cuts={spans.slice(1).map((span) => span.start)}
      />
      <p className="dual-legend">{strings.direction.tensionLegend}</p>
      {onLayout !== null && <p className="dual-legend">{strings.direction.dragHint}</p>}
    </div>
  )
}
