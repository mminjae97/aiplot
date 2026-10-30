// @vitest-environment node
import { expect, test } from 'vitest'
import { minimumWindowSize } from '../../electron/windowSize'

const FRAME = { width: 16, height: 39 }

test('half the work area wide; tall enough for the widest open book at that width', () => {
  // 960 - 16 frame - 128 margin = 816 wide spread, 612 tall; + 48 bar + 128 margin + frame.
  expect(minimumWindowSize({ width: 1920, height: 1032 }, FRAME)).toEqual({
    width: 960,
    height: 827,
  })
})

test('never taller than the work area', () => {
  expect(minimumWindowSize({ width: 2560, height: 700 }, FRAME)).toEqual({
    width: 1280,
    height: 700,
  })
})
