import { expect, test } from 'vitest'
import {
  MIN_CONTRAST,
  PRESETS,
  bindingOf,
  colorOf,
  contrast,
  letteringOf,
} from '../src/components/bookColor'
import { centreCrop } from '../src/components/cropCover'

const GILT = '#e8c877'
const INK = '#2e2219'

test('cloth presets keep the gilt lettering', () => {
  for (const preset of PRESETS) expect(letteringOf(preset.color)).toBe(GILT)
  expect(new Set(PRESETS.map((p) => p.name)).size).toBe(7)
})

test('light cloth switches to dark ink', () => {
  for (const cloth of ['#ffffff', '#ede3cf', '#f2d16b', '#9fc5e8']) {
    expect(letteringOf(cloth)).toBe(INK)
  }
})

test('lettering reads at 4.5:1 or more on every colour', () => {
  const steps = [...Array(18).keys()].map((n) => Math.min(255, n * 15))
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  for (const r of steps)
    for (const g of steps)
      for (const b of steps) {
        const cloth = `#${hex(r)}${hex(g)}${hex(b)}`
        expect(contrast(letteringOf(cloth), cloth)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
})

test('an uncoloured book keeps its default binding', () => {
  expect(colorOf({ id: 'w_1', color: null })).toBe(bindingOf('w_1'))
  expect(colorOf({ id: 'w_1', color: '#123456' })).toBe('#123456')
})

test('illustrations are cut from the centre at 1:1.5', () => {
  // Landscape: full height, the middle third-ish of the width.
  expect(centreCrop(1200, 900)).toEqual({ x: 300, y: 0, width: 600, height: 900 })
  // Tall: full width, trimmed top and bottom.
  expect(centreCrop(600, 1100)).toEqual({ x: 0, y: 100, width: 600, height: 900 })
  // Already 1:1.5: untouched.
  expect(centreCrop(400, 600)).toEqual({ x: 0, y: 0, width: 400, height: 600 })
})
