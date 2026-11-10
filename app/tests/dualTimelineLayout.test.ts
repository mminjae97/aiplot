import { expect, test } from 'vitest'
import {
  addCut,
  chapterSpans,
  layoutOf,
  moveCut,
  moveScene,
  narrationOrder,
  removeCut,
  reorderedScenes,
  sameLayout,
  storyOrder,
  tensionPoints,
} from '../src/components/dualTimelineLayout'
import type { DirectionPlan, EpisodeCard } from '../src/types'

type Beat = { tension: number }
type Item = number | [number, Beat[]] | [number, Beat[], string]

function plan(chapters: Item[][]): DirectionPlan {
  return {
    episode: 'c_ep1',
    chapters: chapters.map((scenes, at) => ({
      chapter: at + 1,
      target_chars: 5500,
      scenes: scenes.map((item) => {
        const [scene, beats, source] = typeof item === 'number' ? [item, [], '위기'] : item
        return { scene, beats, source: source ?? '위기' }
      }),
    })),
  } as unknown as DirectionPlan
}

const STRUCTURE = {
  type: 5,
  stages: [
    { name: '발단', summary: 'a', tension: 1 },
    { name: '위기', summary: 'c', tension: 4 },
    { name: '결말', summary: 'e', tension: null },
  ],
} as unknown as EpisodeCard['data']['structure']

test('story order sorts by scene number; narration keeps the told order across chapters', () => {
  const p = plan([[3, 1], [2]])
  expect(narrationOrder(p).map((s) => s.scene)).toEqual([3, 1, 2])
  expect(storyOrder(p).map((s) => s.scene)).toEqual([1, 2, 3])
})

test('told in order, nothing is reordered', () => {
  expect([...reorderedScenes(plan([[1, 2], [3]]))]).toEqual([])
})

test('one flashback moved forward marks only that scene, not those it jumps over', () => {
  expect([...reorderedScenes(plan([[4, 1, 2, 3, 5]]))]).toEqual([4])
})

test('moved across a chapter cut still counts', () => {
  expect([
    ...reorderedScenes(
      plan([
        [1, 3],
        [2, 4],
      ]),
    ),
  ]).toHaveLength(1)
})

test('a chapter spans its scenes, in the told columns', () => {
  expect(chapterSpans(plan([[1, 2], [3], [4, 5]]))).toEqual([
    { chapter: 1, targetChars: 5500, start: 0, count: 2 },
    { chapter: 2, targetChars: 5500, start: 2, count: 1 },
    { chapter: 3, targetChars: 5500, start: 3, count: 2 },
  ])
})

test('directed scenes give a point per beat spread over their column', () => {
  const p = plan([[[1, [{ tension: 2 }, { tension: 4 }]]]])
  expect(tensionPoints(p, STRUCTURE)).toEqual([
    { x: 0.25, tension: 2, estimated: false },
    { x: 0.75, tension: 4, estimated: false },
  ])
})

test('undirected scenes take their stage tension, or give no point if it has none', () => {
  const p = plan([
    [
      [1, [], '발단'],
      [2, [], '결말'],
      [3, [], '없는 단계'],
      [4, [], '위기'],
    ],
  ])
  expect(tensionPoints(p, STRUCTURE)).toEqual([
    { x: 0.5, tension: 1, estimated: true },
    { x: 3.5, tension: 4, estimated: true },
  ])
  expect(tensionPoints(p, null)).toEqual([])
})

test('the layout is what PATCH takes; equal layouts are equal', () => {
  const layout = layoutOf(plan([[3, 1], [2]]))
  expect(layout).toEqual([[3, 1], [2]])
  expect(sameLayout(layout, [[3, 1], [2]])).toBe(true)
  expect(sameLayout(layout, [[3], [1, 2]])).toBe(false)
})

const TWO = [
  [1, 2, 3],
  [4, 5],
]

test('a scene lands before or after its target, in the target chapter', () => {
  expect(moveScene(TWO, 4, 1, false)).toEqual([[4, 1, 2, 3], [5]])
  expect(moveScene(TWO, 1, 3, true)).toEqual([
    [2, 3, 1],
    [4, 5],
  ])
  expect(moveScene(TWO, 3, 4, true)).toEqual([
    [1, 2],
    [4, 3, 5],
  ])
})

test('dropped on itself nothing changes', () => {
  expect(sameLayout(moveScene(TWO, 2, 2, true), TWO)).toBe(true)
})

test('a chapter left empty goes', () => {
  expect(moveScene([[1, 2], [3]], 3, 1, false)).toEqual([[3, 1, 2]])
})

test('a cut moves to a boundary between scenes', () => {
  expect(moveCut(TWO, 0, 2)).toEqual([
    [1, 2],
    [3, 4, 5],
  ])
  expect(moveCut(TWO, 0, 4)).toEqual([[1, 2, 3, 4], [5]])
})

test('a cut stays clear of its neighbours and the ends: no chapter goes empty', () => {
  const three = [[1, 2], [3], [4, 5]]
  expect(moveCut(three, 0, 9)).toEqual([[1, 2], [3], [4, 5]])
  expect(moveCut(three, 1, 1)).toEqual([[1, 2], [3], [4, 5]])
  expect(moveCut(TWO, 0, 0)).toEqual([[1], [2, 3, 4, 5]])
  expect(moveCut(TWO, 0, 99)).toEqual([[1, 2, 3, 4], [5]])
})

test('a new cut splits the chapter it falls in', () => {
  expect(addCut(TWO, 1)).toEqual([[1], [2, 3], [4, 5]])
  expect(addCut(TWO, 4)).toEqual([[1, 2, 3], [4], [5]])
})

test('a cut on an existing boundary or an end changes nothing', () => {
  expect(addCut(TWO, 3)).toEqual(TWO)
  expect(addCut(TWO, 0)).toEqual(TWO)
  expect(addCut(TWO, 5)).toEqual(TWO)
})

test('taking a cut away joins its two chapters in order', () => {
  expect(removeCut([[1, 2], [3], [4, 5]], 0)).toEqual([
    [1, 2, 3],
    [4, 5],
  ])
  expect(removeCut([[1, 2], [3], [4, 5]], 1)).toEqual([
    [1, 2],
    [3, 4, 5],
  ])
})
