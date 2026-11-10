import type { CSSProperties } from 'react'
import { strings } from '../strings'
import type { DirectionPlan, EpisodeCard, PlanScene } from '../types'
import {
  chapterSpans,
  narrationOrder,
  reorderedScenes,
  storyOrder,
  tensionPoints,
} from './dualTimelineLayout'
import { TensionChart } from './TensionChart'

type Props = {
  plan: DirectionPlan
  structure: EpisodeCard['data']['structure']
  selected: number
  onSelect: (scene: number) => void
}

/** The dual timeline (§9): the scenes in story order over the same scenes as told, each linked
 * to itself; those told out of order in the accent (and with a mark). Below, the chapters and
 * the tension curve in the told columns. */
export function DualTimeline({ plan, structure, selected, onSelect }: Props) {
  const told = narrationOrder(plan)
  const story = storyOrder(plan)
  const reordered = reorderedScenes(plan)
  const spans = chapterSpans(plan)
  const columns = told.length
  const toldAt = new Map(told.map((scene, at) => [scene.scene, at]))

  const node = (scene: PlanScene, withStatus: boolean) => {
    const moved = reordered.has(scene.scene)
    return (
      <button
        key={scene.scene}
        type="button"
        className="timeline-scene"
        data-status={scene.status}
        data-reordered={moved ? '' : undefined}
        aria-current={scene.scene === selected ? 'true' : undefined}
        aria-label={strings.direction.sceneLabel(
          scene.scene,
          scene.source,
          strings.direction.sceneStatus[scene.status],
          moved,
        )}
        title={scene.summary}
        onClick={() => {
          onSelect(scene.scene)
        }}
      >
        <span className="timeline-scene-name">
          {strings.direction.sceneName(scene.scene)}
          {moved && <span aria-hidden="true"> {strings.direction.reorderedMark}</span>}
        </span>
        <small>{withStatus ? strings.direction.sceneShort[scene.status] : scene.source}</small>
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
      <div className="dual-row">{told.map((scene) => node(scene, true))}</div>

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
    </div>
  )
}
