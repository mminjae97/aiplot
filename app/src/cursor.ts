// The quill cursor (§5). The browser draws it (CSS `cursor` in base.css) except where the image
// would cross the window's top or right edge: Chromium then swaps any custom cursor for its own
// default, so there the app hides the cursor and draws the same quill itself.
import quill from './assets/cursor/quill.svg'
import quillHover from './assets/cursor/quill-hover.svg'

const SIZE = 32
// The nib, bottom left (base.css uses the same hotspot).
const HOT_X = 2
const HOT_Y = 30

/** Whether the quill drawn at (x, y) would reach past the top or right edge of the window. */
export function nearEdge(x: number, y: number, width: number): boolean {
  return y - HOT_Y < 1 || x - HOT_X + SIZE > width - 1
}

const CLICKABLE = 'button:not(:disabled), a[href], [role="tab"], [role="button"], label, summary'

/** Starts drawing the quill near the edges; returns a function that stops it. */
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
    if (!nearEdge(x, y, window.innerWidth)) {
      hide()
      return
    }
    // Set once on entering the edge: each change restyles the whole page.
    if (!root.hasAttribute('data-edge-cursor')) root.setAttribute('data-edge-cursor', '')
    const target = event.target instanceof Element ? event.target : null
    const source = target?.closest(CLICKABLE) ? quillHover : quill
    if (image.getAttribute('src') !== source) image.src = source
    image.style.transform = `translate(${String(x - HOT_X)}px, ${String(y - HOT_Y)}px)`
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
