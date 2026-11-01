import { afterEach, expect, test } from 'vitest'
import { installCursor, nearEdge } from '../src/cursor'

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
})

test('the quill crosses an edge near the top and right, and at the outermost left and bottom', () => {
  // 32px image, nib (hotspot) 2px in from its bottom left: it reaches 30px up and 30px right,
  // 2px left and 2px down.
  expect(nearEdge(500, 500, 1920, 1032)).toBe(false)
  expect(nearEdge(500, 20, 1920, 1032)).toBe(true)
  expect(nearEdge(1900, 500, 1920, 1032)).toBe(true)
  expect(nearEdge(0, 500, 1920, 1032)).toBe(true)
  expect(nearEdge(500, 1031, 1920, 1032)).toBe(true)
  expect(nearEdge(5, 1025, 1920, 1032)).toBe(false)
})

test('near an edge the app hides the cursor and draws the quill itself', () => {
  stop = installCursor()
  const image = document.querySelector<HTMLImageElement>('.app-cursor')
  const move = (x: number, y: number) => {
    window.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y }), {
        pointerType: 'mouse',
      }),
    )
  }
  expect(image?.hidden).toBe(true)
  move(400, 10)
  expect(document.documentElement.hasAttribute('data-edge-cursor')).toBe(true)
  expect(image?.hidden).toBe(false)
  expect(image?.getAttribute('aria-hidden')).toBe('true')
  move(400, 400)
  expect(document.documentElement.hasAttribute('data-edge-cursor')).toBe(false)
  expect(image?.hidden).toBe(true)
})
