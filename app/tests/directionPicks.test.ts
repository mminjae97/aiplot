import { expect, test } from 'vitest'
import {
  deviceGroups,
  isDirectionCandidate,
  pickRefusal,
  sameCards,
} from '../src/components/directionPicks'
import { DEVICES } from '../src/strings/devices'
import type { PlanScene, Technique } from '../src/types'

const scene = (ai: string[], sub: string[]) =>
  ({ ai_devices: ai, sub_devices: sub }) as unknown as PlanScene
const card = (id: string, name: string, conflicts: string[] = []) =>
  ({ id, name, conflicts_with: conflicts }) as unknown as Technique

test('the AI answers lead; a device is in one group only; all 41 are there', () => {
  const groups = deviceGroups(scene(['overhear'], ['knowledge_gap', 'overhear']))
  expect(groups.ai).toEqual(['overhear'])
  expect(groups.sub).toEqual(['knowledge_gap'])
  expect(groups.rest).not.toContain('overhear')
  expect(groups.rest).not.toContain('knowledge_gap')
  expect(groups.ai.length + groups.sub.length + groups.rest.length).toBe(
    Object.keys(DEVICES).length,
  )
  expect(Object.keys(DEVICES)).toHaveLength(41)
})

test('scene and episode cards are candidates; serial and sentence-only ones are not', () => {
  expect(isDirectionCandidate({ id: 'tech_inf_001', scope: ['장면'] })).toBe(true)
  expect(isDirectionCandidate({ id: 'tech_str_001', scope: ['회차', '아크'] })).toBe(true)
  expect(isDirectionCandidate({ id: 'tech_rhe_001', scope: ['문장'] })).toBe(false)
  expect(isDirectionCandidate({ id: 'tech_ser_042', scope: ['회차'] })).toBe(false)
})

test('a fourth card is too many', () => {
  const three = [card('a', '가'), card('b', '나'), card('c', '다')]
  expect(pickRefusal(3, three, card('d', '라'))).toEqual({ kind: 'too_many' })
})

test('the limit goes by the count, even with cards not loaded yet', () => {
  expect(pickRefusal(3, [card('a', '가')], card('d', '라'))).toEqual({ kind: 'too_many' })
  expect(pickRefusal(3, [], undefined)).toEqual({ kind: 'too_many' })
  expect(pickRefusal(2, [], undefined)).toBeNull()
})

test('a pair conflicts if either lists the other', () => {
  expect(pickRefusal(1, [card('a', '가', ['b'])], card('b', '나'))).toEqual({
    kind: 'conflict',
    name: '가',
  })
  expect(pickRefusal(1, [card('a', '가')], card('b', '나', ['a']))).toEqual({
    kind: 'conflict',
    name: '가',
  })
  expect(pickRefusal(1, [card('a', '가')], card('b', '나'))).toBeNull()
})

test('the same cards in another order are other cards', () => {
  expect(sameCards(['a', 'b'], ['a', 'b'])).toBe(true)
  expect(sameCards(['a', 'b'], ['b', 'a'])).toBe(false)
  expect(sameCards(['a'], ['a', 'b'])).toBe(false)
})
