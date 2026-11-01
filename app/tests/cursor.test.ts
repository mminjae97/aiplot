import { afterEach, expect, test } from 'vitest'
import { installCursor, nearEdge } from '../src/cursor'

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
})

test('the quill crosses the edge only near the top and the right', () => {
  // 32px image, nib (hotspot) at its bottom left: it reaches 30px up and 30px right.
  expect(nearEdge(500, 500, 1920)).toBe(false)
  expect(nearEdge(500, 20, 1920)).toBe(true)
  expect(nearEdge(1900, 500, 1920)).toBe(true)
  // The left and bottom edges are clear of it.
  expect(nearEdge(0, 1031, 1920)).toBe(false)
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
