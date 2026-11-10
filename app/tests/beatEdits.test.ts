import { expect, test } from 'vitest'
import { allowedCards, moveItem, serialFor, toEdit } from '../src/components/beatEdits'
import type { DirectionPlan, PlanBeat, PlanScene } from '../src/types'

const plan = (scenes: number[][]) =>
  ({
    chapters: scenes.map((numbers) => ({ scenes: numbers.map((scene) => ({ scene })) })),
  }) as unknown as DirectionPlan

test('serial cards follow the place in the chapter', () => {
  const p = plan([[1, 2, 3], [4]])
  expect(serialFor(p, 1)).toEqual(['tech_ser_042', 'tech_ser_020', 'tech_ser_021'])
  expect(serialFor(p, 2)).toEqual(['tech_ser_020', 'tech_ser_021'])
  expect(serialFor(p, 3)).toEqual(['tech_ser_020', 'tech_ser_021', 'tech_ser_019'])
  expect(serialFor(p, 4)).toEqual(['tech_ser_042', 'tech_ser_020', 'tech_ser_021', 'tech_ser_019'])
})

test('a beat may name the chosen cards and the place serial cards, each once', () => {
  const scene = { scene: 2, chosen: ['tech_a', 'tech_ser_020'] } as unknown as PlanScene
  expect(allowedCards(plan([[1, 2, 3]]), scene)).toEqual(['tech_a', 'tech_ser_020', 'tech_ser_021'])
})

test('the edit carries everything but the number the server gives', () => {
  const beat = { order: 3, summary: 'a', techniques: [], tension: 2 } as unknown as PlanBeat
  expect(toEdit(beat)).not.toHaveProperty('order')
  expect(toEdit(beat).summary).toBe('a')
})

test('an item lands at the insertion point of the list as it stands', () => {
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'a', 'c'])
  expect(moveItem(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a'])
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'b', 'c'])
})
