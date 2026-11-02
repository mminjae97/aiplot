import { expect, test } from 'vitest'
import { columnOf, perPage } from '../src/components/dexGrid'

test('cards per page follow the width, one at least', () => {
  expect(perPage(0)).toBe(1)
  expect(perPage(400)).toBe(1)
  // Three 168px cards with their 22px gaps on each page, the spine between.
  expect(perPage(52 + 2 * 3 * 190)).toBe(3)
  expect(perPage(52 + 2 * 3 * 190 - 1)).toBe(2)
})

test('rows run across the left page then the right, skipping the spine column', () => {
  // Two per page: columns 1 2 | 4 5, then the next row.
  expect([0, 1, 2, 3, 4, 5].map((index) => columnOf(index, 2))).toEqual([1, 2, 4, 5, 1, 2])
})
