// While a node or the ground of the relation graph or the region map is dragged, the pressed
// paperweight shows over everything (§5; base.css html[data-dragging]). Left to the element under
// the pointer, it would flicker: a dragged node lags a frame behind the pointer, so the pointer is
// over the node one move and over the ground or a line the next.

const ATTRIBUTE = 'data-dragging'

function stop(): void {
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
  if (event !== null && event.type !== 'wheel') startDragCursor()
}
