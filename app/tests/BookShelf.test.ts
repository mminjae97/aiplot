import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { expect, test, vi } from 'vitest'
import { BookItem, bindingOf } from '../src/components/BookItem'
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

test('bindings are stable per work', () => {
  for (const work of works(30)) expect(bindingOf(work.id)).toBe(bindingOf(work.id))
  expect(new Set(works(30).map((w) => bindingOf(w.id))).size).toBeGreaterThan(3)
})

test('covers keep their order across boards, as many per board as fit, + book last', () => {
  const list = works(20)
  // 1440 wide: (1440 - 96 + 28) / (150 + 28) = 7 per board.
  const shelves = packShelves(list, 1440, 600)
  expect(shelves.map((s) => s.length)).toEqual([7, 7, 7])
  expect(shelves.flat().map((s) => (s.kind === 'work' ? s.work.id : 'new'))).toEqual([
    ...list.map((w) => w.id),
    'new',
  ])
  expect(packShelves(list, 300, 600)[0]).toHaveLength(1)
})

test('empty boards fill the visible height but never force a scroll', () => {
  expect(packShelves([], 1440, 852)).toHaveLength(2)
  expect(packShelves([], 1440, 300)).toHaveLength(1)
  expect(packShelves([], 1440, 1300)).toHaveLength(4)
})

test('slips open away from the nearer bookcase side', () => {
  const [shelf] = packShelves(works(10), 1440, 852)
  expect(shelf?.[0]?.slip).toBe('right')
  expect(shelf?.at(-1)?.slip).toBe('left')
})

test('an illustrated cover shows the illustration only', () => {
  const [work] = works(1)
  if (!work) throw new Error('no work')
  const props = { work, slip: 'right' as const, newest: false, highlighted: false, onOpen: vi.fn() }
  const { container, rerender } = render(createElement(BookItem, props))
  expect(container.querySelector('.book-title')?.textContent).toBe(work.title)
  rerender(createElement(BookItem, { ...props, cover: 'cover.png' }))
  expect(container.querySelector('.book-title')).toBeNull()
  expect(container.querySelector('img.book-art')?.getAttribute('src')).toBe('cover.png')
  // The title still names the book for screen readers and in the slip.
  expect(screen.getByRole('button', { name: work.title })).toBeTruthy()
})
