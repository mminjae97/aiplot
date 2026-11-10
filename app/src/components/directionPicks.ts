// The S2 right column's rules (§9): the order of a scene's devices and which technique cards
// may be picked. The server checks the same rules on save; here they answer at once.
import { DEVICES } from '../strings/devices'
import type { PlanScene, Technique, TechniqueDevice, TechniqueSummary } from '../types'

export const MAX_CHOSEN = 3

// Placed by the server per scene (§9 SERIAL_TECHNIQUES); never picked.
const SERIAL = new Set(['tech_ser_019', 'tech_ser_020', 'tech_ser_021', 'tech_ser_042'])

/** Cards the catalog offers for a scene: scope 장면 or 회차, not a serial card (§9). */
export function isDirectionCandidate(card: Pick<TechniqueSummary, 'id' | 'scope'>): boolean {
  return !SERIAL.has(card.id) && card.scope.some((scope) => scope === '장면' || scope === '회차')
}

export type DeviceGroups = {
  ai: TechniqueDevice[]
  sub: TechniqueDevice[]
  rest: TechniqueDevice[]
}

/** The AI's main answers first, then its sub answers, the rest below, each in a fixed order
 * so that checking one never moves it. */
export function deviceGroups(scene: PlanScene): DeviceGroups {
  const ai = scene.ai_devices
  const sub = scene.sub_devices.filter((device) => !ai.includes(device))
  const listed = new Set<TechniqueDevice>([...ai, ...sub])
  const rest = (Object.keys(DEVICES) as TechniqueDevice[]).filter((device) => !listed.has(device))
  return { ai, sub, rest }
}

export type PickRefusal = { kind: 'too_many' } | { kind: 'conflict'; name: string }

/** Why a card cannot join the `count` picked, or null. `chosen` and `next` are those whose
 * details have arrived, so the limit goes by the count; a conflict with a card not loaded yet
 * is left to the server's check on saving. A pair conflicts if either lists the other. */
export function pickRefusal(
  count: number,
  chosen: readonly Technique[],
  next: Technique | undefined,
): PickRefusal | null {
  if (count >= MAX_CHOSEN) return { kind: 'too_many' }
  if (next === undefined) return null
  const clash = chosen.find(
    (card) => card.conflicts_with.includes(next.id) || next.conflicts_with.includes(card.id),
  )
  return clash ? { kind: 'conflict', name: clash.name } : null
}

export function sameCards(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at])
}
