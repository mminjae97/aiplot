// The dex cards' grid on the two pages (book.css .page-wide .dex-grid): rows run across the
// left page, then the right, never across the spine.

// Card width, the gap between cards, and the room at the spine between the pages' last and
// first columns.
const CARD = 168
const GAP = 22
const SPINE = 52

/** How many cards fit across one page of a grid `width` wide (at least one). */
export function perPage(width: number): number {
  return Math.max(1, Math.floor((width - SPINE) / (2 * (CARD + GAP))))
}

/** The grid column of the card at `index`: rows run across both pages, left page first, and
 * skip the column at the spine. */
export function columnOf(index: number, across: number): number {
  const column = index % (2 * across)
  return column < across ? column + 1 : column + 2
}
