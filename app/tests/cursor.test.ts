import { afterEach, expect, test } from 'vitest'
import dragging from '../src/assets/cursor/dragging.svg'
import quill from '../src/assets/cursor/quill.svg'
import {
  startDragCursor,
  startGroundDrag,
  stopDragCursor,
  stopGroundDrag,
} from '../src/components/dragCursor'
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

test('the drawn quill is the same over clickables and over anything else (§5: no gilt one)', () => {
  stop = installCursor()
  const image = document.querySelector<HTMLImageElement>('.app-cursor')
  const button = document.createElement('button')
  document.body.append(button)
  const over = (target: Element) => {
    target.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX: 400, clientY: 10, bubbles: true }), {
        pointerType: 'mouse',
      }),
    )
    return image?.getAttribute('src')
  }
  expect(over(button)).toBe(quill)
  expect(over(document.body)).toBe(quill)
  button.remove()
})

test('while something is dragged the edge draws the pressed paperweight, centred on the pointer', () => {
  stop = installCursor()
  const image = document.querySelector<HTMLImageElement>('.app-cursor')
  const move = (x: number, y: number) => {
    window.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y }), {
        pointerType: 'mouse',
      }),
    )
  }
  startDragCursor()
  // The paperweight reaches 16px each way: 20px from the top is clear of the edge, 10px is not.
  move(400, 20)
  expect(image?.hidden).toBe(true)
  move(400, 10)
  expect(image?.hidden).toBe(false)
  expect(image?.getAttribute('src')).toBe(dragging)
  expect(image?.style.transform).toBe('translate(384px, -6px)')
  stopDragCursor()
  move(400, 10)
  expect(image?.getAttribute('src')).toBe(quill)
})

test('a drag shows the pressed paperweight until the pointer is let go', () => {
  const root = document.documentElement
  startDragCursor()
  expect(root.hasAttribute('data-dragging')).toBe(true)
  window.dispatchEvent(new MouseEvent('pointerup'))
  expect(root.hasAttribute('data-dragging')).toBe(false)
  // A wheel zoom or a move made in code is no drag.
  startGroundDrag(new WheelEvent('wheel'))
  startGroundDrag(null)
  expect(root.hasAttribute('data-dragging')).toBe(false)
  startGroundDrag(new MouseEvent('mousedown'))
  expect(root.hasAttribute('data-dragging')).toBe(true)
  stopGroundDrag()
  expect(root.hasAttribute('data-dragging')).toBe(false)
})

test('a move made in code while a node is dragged (the auto-pan) never lets go', () => {
  const root = document.documentElement
  startDragCursor()
  // React Flow's auto-pan near the edge: onMoveStart(null) … onMoveEnd(null).
  startGroundDrag(null)
  stopGroundDrag()
  expect(root.hasAttribute('data-dragging')).toBe(true)
  stopDragCursor()
  expect(root.hasAttribute('data-dragging')).toBe(false)
})
