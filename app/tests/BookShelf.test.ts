import { expect, test } from 'vitest'
import { spineOf } from '../src/components/BookItem'
import { packShelves } from '../src/components/BookShelf'
import type { Work } from '../src/types'

function works(n: number): Work[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w_${String(i)}`,
    title: `책 ${String(i)}`,
    stage: 1,
    locked_stage: 0,
    last_item: null,
    updated_at: '2026-10-30T09:00:00.000Z',
  }))
}

test('spines are stable per work and within their ranges', () => {
  for (const work of works(50)) {
    const spine = spineOf(work.id)
    expect(spineOf(work.id)).toEqual(spine)
    expect(spine.width).toBeGreaterThanOrEqual(46)
    expect(spine.width).toBeLessThanOrEqual(62)
    expect(spine.height).toBeGreaterThanOrEqual(206)
    expect(spine.height).toBeLessThanOrEqual(249)
  }
})

test('books keep their order across boards and the + book comes last', () => {
  const list = works(40)
  const shelves = packShelves(list, 900, 600)
  const flat = shelves.flat()
  expect(flat.map((s) => (s.kind === 'work' ? s.work.id : 'new'))).toEqual([
    ...list.map((w) => w.id),
    'new',
  ])
  expect(shelves.length).toBeGreaterThan(1)
  for (const shelf of shelves) {
    const used = shelf.reduce(
      (sum, s) => sum + (s.kind === 'work' ? spineOf(s.work.id).width : 58) + 3,
      0,
    )
    expect(used).toBeLessThanOrEqual(900 - 88)
  }
})

test('empty boards fill the visible height but never force a scroll', () => {
  expect(packShelves([], 1440, 852)).toHaveLength(2)
  expect(packShelves([], 1440, 300)).toHaveLength(1)
  expect(packShelves([], 1440, 1300)).toHaveLength(4)
})

test('slips open away from the nearer bookcase side', () => {
  const [shelf] = packShelves(works(30), 1440, 852)
  expect(shelf?.[0]?.slip).toBe('right')
  expect(shelf?.at(-1)?.slip).toBe('left')
})
