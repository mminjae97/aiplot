// The S2 dual timeline (§9): story order over narration order, chapter cuts and the tension
// curve, all laid out in the narration's columns.
import type { DirectionPlan, EpisodeCard, PlanScene } from '../types'

type Structure = EpisodeCard['data']['structure']

export function narrationOrder(plan: DirectionPlan): PlanScene[] {
  return plan.chapters.flatMap((chapter) => chapter.scenes)
}

export function storyOrder(plan: DirectionPlan): PlanScene[] {
  return [...narrationOrder(plan)].sort((a, b) => a.scene - b.scene)
}

/** The scenes told out of story order: all but a longest run told in order. By position alone,
 * one flashback moved forward would mark every scene it jumps over. */
export function reorderedScenes(plan: DirectionPlan): Set<number> {
  const told = narrationOrder(plan).map((scene) => scene.scene)
  // Length of the longest increasing run ending at each scene, and the scene before it there.
  const length = told.map(() => 1)
  const previous = told.map(() => -1)
  told.forEach((scene, at) => {
    for (let before = 0; before < at; before += 1) {
      if (
        (told[before] as number) < scene &&
        (length[before] as number) + 1 > (length[at] as number)
      ) {
        length[at] = (length[before] as number) + 1
        previous[at] = before
      }
    }
  })
  let at = length.indexOf(Math.max(...length))
  const kept = new Set<number>()
  while (at !== -1) {
    kept.add(told[at] as number)
    at = previous[at] as number
  }
  return new Set(told.filter((scene) => !kept.has(scene)))
}

export type ChapterSpan = { chapter: number; targetChars: number; start: number; count: number }

/** Each chapter's columns in the narration row. */
export function chapterSpans(plan: DirectionPlan): ChapterSpan[] {
  let start = 0
  return plan.chapters.map((chapter) => {
    const span = {
      chapter: chapter.chapter,
      targetChars: chapter.target_chars,
      start,
      count: chapter.scenes.length,
    }
    start += chapter.scenes.length
    return span
  })
}

export type TensionPoint = {
  /** In narration columns: scene n covers n to n + 1. */
  x: number
  tension: number
  /** The stage's planned tension: the scene has no beats yet. */
  estimated: boolean
}

/** A point per beat of each directed scene, spread over its column; a scene without beats has
 * its stage's tension in the middle, or no point if the stage has none. */
export function tensionPoints(plan: DirectionPlan, structure: Structure): TensionPoint[] {
  const stages = new Map<string, number | null>(
    (structure?.stages ?? []).map((stage) => [stage.name, stage.tension]),
  )
  return narrationOrder(plan).flatMap((scene, column): TensionPoint[] => {
    if (scene.beats.length > 0) {
      return scene.beats.map((beat, at) => ({
        x: column + (at + 0.5) / scene.beats.length,
        tension: beat.tension,
        estimated: false,
      }))
    }
    const tension = stages.get(scene.source) ?? null
    return tension === null ? [] : [{ x: column + 0.5, tension, estimated: true }]
  })
}

/** The plan's layout as PATCH /plans/{planId} takes it: each chapter's scene numbers, told. */
export function layoutOf(plan: DirectionPlan): number[][] {
  return plan.chapters.map((chapter) => chapter.scenes.map((scene) => scene.scene))
}

export function sameLayout(a: readonly number[][], b: readonly number[][]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The scene dropped before or after `target`, in the target's chapter. A chapter it leaves
 * empty goes, and its cut with it. */
export function moveScene(
  layout: readonly number[][],
  scene: number,
  target: number,
  after: boolean,
): number[][] {
  if (scene === target) return layout.map((chapter) => [...chapter])
  return layout
    .map((chapter) => chapter.filter((item) => item !== scene))
    .map((chapter) => {
      const at = chapter.indexOf(target)
      return at === -1 ? chapter : chapter.toSpliced(after ? at + 1 : at, 0, scene)
    })
    .filter((chapter) => chapter.length > 0)
}

/** The end of chapter `cut` moved to column boundary `boundary` of the told row, kept between
 * its neighbours: cuts lie between scenes and no chapter is left empty. */
export function moveCut(layout: readonly number[][], cut: number, boundary: number): number[][] {
  const told = layout.flat()
  const ends: number[] = []
  let end = 0
  for (const chapter of layout) {
    end += chapter.length
    ends.push(end)
  }
  const low = (ends[cut - 1] ?? 0) + 1
  const high = (ends[cut + 1] ?? told.length) - 1
  ends[cut] = Math.min(high, Math.max(low, boundary))
  return ends.map((stop, at) => told.slice(ends[at - 1] ?? 0, stop))
}
