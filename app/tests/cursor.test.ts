import { afterEach, expect, test } from 'vitest'
import quill from '../src/assets/cursor/quill.svg'
import quillHover from '../src/assets/cursor/quill-hover.svg'
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

test('the drawn quill turns gilt over clickables, not over aria-disabled ones', () => {
  stop = installCursor()
  const image = document.querySelector<HTMLImageElement>('.app-cursor')
  const live = document.createElement('button')
  const off = document.createElement('button')
  off.setAttribute('aria-disabled', 'true')
  off.append(document.createElement('span'))
  document.body.append(live, off)
  const over = (target: Element) => {
    target.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX: 400, clientY: 10, bubbles: true }), {
        pointerType: 'mouse',
      }),
    )
    return image?.getAttribute('src')
  }
  expect(over(live)).toBe(quillHover)
  // A desk side with nothing to turn to (.book-turn): plain, as CSS draws it.
  expect(over(off)).toBe(quill)
  expect(over(off.firstElementChild ?? off)).toBe(quill)
  expect(over(document.body)).toBe(quill)
  live.remove()
  off.remove()
})
