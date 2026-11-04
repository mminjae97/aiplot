// While a node or the ground of the relation graph or the region map is dragged, the pressed
// paperweight shows over everything (§5; base.css html[data-dragging]). Left to the element under
// the pointer, it would flicker: a dragged node lags a frame behind the pointer, so the pointer is
// over the node one move and over the ground or a line the next.

const ATTRIBUTE = 'data-dragging'

// Whether the ground is what is dragged: React Flow also reports moves made in code (fitView,
// the auto-pan while a node is dragged near the edge), and their end must not let go.
let ground = false

function stop(): void {
  ground = false
  document.documentElement.removeAttribute(ATTRIBUTE)
  window.removeEventListener('pointerup', stop, true)
  window.removeEventListener('blur', stop)
}

/** Shows the pressed paperweight until the drag ends (or the pointer is let go anywhere). */
export function startDragCursor(): void {
  document.documentElement.setAttribute(ATTRIBUTE, '')
  // A drag that ends outside the flow, or never reports its end, still lets go.
  window.addEventListener('pointerup', stop, true)
  window.addEventListener('blur', stop)
}

export const stopDragCursor = stop

/** React Flow's onMoveStart: a drag of the ground, not a wheel zoom or a move made in code. */
export function startGroundDrag(event: MouseEvent | TouchEvent | null): void {
  if (event === null || event.type === 'wheel') return
  startDragCursor()
  ground = true
}

/** React Flow's onMoveEnd: ends only a drag of the ground (a node's drag ends on its own). */
export function stopGroundDrag(): void {
  if (ground) stop()
}
