import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { expect, test, vi } from 'vitest'
import { BookItem } from '../src/components/BookItem'
import { bindingOf } from '../src/components/bookColor'
import { packShelves } from '../src/components/BookShelf'
import type { Work } from '../src/types'

function works(n: number): Work[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w_${String(i)}`,
    title: `책 ${String(i)}`,
    stage: 1,
    locked_stage: 0,
    last_item: null,
    color: null,
    cover_id: null,
    updated_at: '2026-10-30T09:00:00.000Z',
  }))
}

test('bindings are stable per work', () => {
  for (const work of works(30)) expect(bindingOf(work.id)).toBe(bindingOf(work.id))
  expect(new Set(works(30).map((w) => bindingOf(w.id))).size).toBeGreaterThan(3)
})

test('covers keep their order across boards, as many per board as fit, + book last', () => {
  const list = works(20)
  // 1440 wide: (1440 - 96 + 100) / (206 + 100) = 4 per board (front 200 + spine 6), a gap of half a cover.
  const shelves = packShelves(list, 1440, 600)
  expect(shelves.map((s) => s.length)).toEqual([4, 4, 4, 4, 4, 1, 0])
  expect(shelves.flat().map((s) => (s.kind === 'work' ? s.work.id : 'new'))).toEqual([
    ...list.map((w) => w.id),
    'new',
  ])
  expect(packShelves(list, 300, 600)[0]).toHaveLength(1)
})

test('empty boards fill the visible height', () => {
  // A board takes half a cover of clear space + a cover + the board: 150 + 300 + 22, and the
  // bookcase keeps 40px below the last one.
  expect(packShelves([], 1440, 1500)).toHaveLength(3)
  expect(packShelves(works(2), 1440, 1500).map((s) => s.length)).toEqual([3, 0, 0])
})

test('the last books always have one empty board below them, scrolling if need be', () => {
  // The + book alone, two boards' height: its board and an empty one.
  expect(packShelves([], 1440, 984).map((s) => s.length)).toEqual([1, 0])
  // Only the + book's board fits: the empty one is below, a scroll away.
  expect(packShelves([], 1440, 852).map((s) => s.length)).toEqual([1, 0])
  // 1440 wide holds 4 per board; 8 works + the + book take 3 boards.
  expect(packShelves(works(8), 1440, 1500).map((s) => s.length)).toEqual([4, 4, 1, 0])
  expect(packShelves(works(8), 1440, 984).map((s) => s.length)).toEqual([4, 4, 1, 0])
  // Full screen 1920: 6 per board, 10 works + the + book fill both visible boards.
  expect(packShelves(works(10), 1920, 984).map((s) => s.length)).toEqual([6, 5, 0])
})

test('an illustrated cover shows the illustration only', () => {
  const [work] = works(1)
  if (!work) throw new Error('no work')
  const props = { work, newest: false, highlighted: false, onOpen: vi.fn() }
  const { container, rerender } = render(createElement(BookItem, props))
  expect(container.querySelector('.book-title')?.textContent).toBe(work.title)
  rerender(createElement(BookItem, { ...props, cover: 'cover.png' }))
  expect(container.querySelector('.book-title')).toBeNull()
  expect(container.querySelector('img.book-art')?.getAttribute('src')).toBe('cover.png')
  // The title still names the book for screen readers.
  expect(screen.getByRole('button', { name: work.title })).toBeTruthy()
})
