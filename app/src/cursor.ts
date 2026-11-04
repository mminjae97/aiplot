// The app's cursor (§5). The browser draws it (CSS `cursor` in base.css) except where the image
// would cross an edge of the window: Chromium then swaps any custom cursor for its own default,
// so there the app hides the cursor and draws the same image itself: the quill, or the pressed
// paperweight while something is dragged (html[data-dragging], components/dragCursor.ts). The
// quill's nib sits 2px inside the image, so even the outermost pixels at the left and bottom count.
import dragging from './assets/cursor/dragging.svg'
import quill from './assets/cursor/quill.svg'

const SIZE = 32

type Hotspot = { x: number; y: number }
// The quill's nib, bottom left, and the paperweight's middle (base.css uses the same hotspots).
const QUILL: Hotspot = { x: 2, y: 30 }
const DRAGGING: Hotspot = { x: 16, y: 16 }

/** Whether the image drawn with its hotspot at (x, y) would reach past an edge of the window. */
export function nearEdge(
  x: number,
  y: number,
  width: number,
  height: number,
  hot: Hotspot = QUILL,
): boolean {
  const left = x - hot.x
  const top = y - hot.y
  return left < 1 || top < 1 || left + SIZE > width - 1 || top + SIZE > height - 1
}

/** Starts drawing the cursor near the edges; returns a function that stops it. */
export function installCursor(): () => void {
  const root = document.documentElement
  const image = document.createElement('img')
  image.className = 'app-cursor'
  image.alt = ''
  image.setAttribute('aria-hidden', 'true')
  image.src = quill
  image.hidden = true
  document.body.append(image)

  const hide = () => {
    image.hidden = true
    root.removeAttribute('data-edge-cursor')
  }
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const { clientX: x, clientY: y } = event
    const drag = root.hasAttribute('data-dragging')
    const hot = drag ? DRAGGING : QUILL
    if (!nearEdge(x, y, window.innerWidth, window.innerHeight, hot)) {
      hide()
      return
    }
    // Set once on entering the edge: each change restyles the whole page.
    if (!root.hasAttribute('data-edge-cursor')) root.setAttribute('data-edge-cursor', '')
    const source = drag ? dragging : quill
    if (image.getAttribute('src') !== source) image.src = source
    image.style.transform = `translate(${String(x - hot.x)}px, ${String(y - hot.y)}px)`
    image.hidden = false
  }
  window.addEventListener('pointermove', move, { capture: true, passive: true })
  root.addEventListener('mouseleave', hide)
  window.addEventListener('blur', hide)
  return () => {
    window.removeEventListener('pointermove', move, { capture: true })
    root.removeEventListener('mouseleave', hide)
    window.removeEventListener('blur', hide)
    hide()
    image.remove()
  }
}
