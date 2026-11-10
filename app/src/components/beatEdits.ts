// Editing a scene's beats (§9, §16 PUT .../beats): what the server takes and which cards a beat
// may name.
import type { BeatEdit, DirectionPlan, PlanBeat, PlanScene } from '../types'

export const BEAT_MODES = ['장면화', '요약'] as const
export const BEAT_FOCUSES = ['감정', '행동', '정보'] as const
export const BEAT_DENSITIES = ['담백', '자세히'] as const
export const TENSIONS = [1, 2, 3, 4, 5] as const

const OPENING_SERIAL = 'tech_ser_042'
const CUT_SERIAL = 'tech_ser_019'
const EVERY_SERIAL = ['tech_ser_020', 'tech_ser_021']

/** The serial cards of a scene's place in its chapter (§9, the server's serial_for). */
export function serialFor(plan: DirectionPlan, scene: number): string[] {
  const chapter = plan.chapters.find((item) => item.scenes.some((s) => s.scene === scene))
  const scenes = chapter?.scenes ?? []
  const at = scenes.findIndex((s) => s.scene === scene)
  const opening = at === 0 ? [OPENING_SERIAL] : []
  const cut = at === scenes.length - 1 ? [CUT_SERIAL] : []
  return [...opening, ...EVERY_SERIAL, ...cut]
}

/** The cards a beat of the scene may name: its chosen cards and the serial ones of its place. */
export function allowedCards(plan: DirectionPlan, scene: PlanScene): string[] {
  return [...new Set([...scene.chosen, ...serialFor(plan, scene.scene)])]
}

export function toEdit(beat: PlanBeat): BeatEdit {
  return {
    summary: beat.summary,
    techniques: beat.techniques,
    pov: beat.pov,
    mode: beat.mode,
    focus: beat.focus,
    density: beat.density,
    tension: beat.tension,
    target_chars: beat.target_chars,
  }
}

/** The list with the item at `from` moved so that it lands at insertion point `to` of the list
 * as it stands (0..n). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const moved = items[from]
  if (moved === undefined) return [...items]
  const rest = items.filter((_, at) => at !== from)
  rest.splice(to > from ? to - 1 : to, 0, moved)
  return rest
}
