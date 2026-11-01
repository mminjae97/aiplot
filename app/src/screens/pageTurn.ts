// A leaf of soft paper turning over the spine (§12 S1 book). The leaf is cut into strips
// hinged one on the next, so it bends: the free edge leads as it lifts and trails as it falls.
// Its front is a picture of the page being turned, its back the page it lands on; the half
// it has not covered yet keeps showing the old page. Pictures are inert copies of the DOM.

export type TurnDirection = 'next' | 'prev'

/** Strips per leaf: more bend more smoothly, each costs two copies of the spread. */
const STRIPS = 6
/** How far each strip bends past the one before it (deg), the root strip none. */
const curlOf = (strip: number) => (strip === 0 ? 0 : 4 + 3 * strip)
/** How far each leaf face reaches over its neighbours (.leaf-face in book.css). */
const FACE_BLEED = 1
/** Matches --turn-time in book.css; the leaf is removed by then even if no event says so. */
const TURN_MS = 650

/** The spread as it looks now, to draw on a leaf. */
export type Picture = {
  node: HTMLElement
  /** [element index in document order, scrollTop, scrollLeft] for every scrolled element
   * (-1 = the spread itself): copies lose their scroll positions. */
  scrolls: [number, number, number][]
}

export function canTurn(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function pictureOf(spread: HTMLElement): Picture {
  const scrolls: [number, number, number][] = []
  if (spread.scrollTop || spread.scrollLeft) scrolls.push([-1, spread.scrollTop, spread.scrollLeft])
  spread.querySelectorAll('*').forEach((element, index) => {
    if (element.scrollTop || element.scrollLeft)
      scrolls.push([index, element.scrollTop, element.scrollLeft])
  })
  return { node: spread.cloneNode(true) as HTMLElement, scrolls }
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

type Placed = { copy: HTMLElement; picture: Picture }

/** A copy of `picture` inside `box`, shifted so the box shows the spread from `offset` on;
 * `bleed` = how far the box starts before that (leaf faces overlap their neighbours). */
function paint(
  box: HTMLElement,
  picture: Picture,
  offset: number,
  size: DOMRect,
  out: Placed[],
  bleed = 0,
) {
  const copy = picture.node.cloneNode(true) as HTMLElement
  copy.style.cssText = `position:absolute;top:0;left:${String(bleed - offset)}px;width:${String(size.width)}px;height:${String(size.height)}px;margin:0`
  box.append(copy)
  out.push({ copy, picture })
}

function restoreScrolls({ copy, picture }: Placed) {
  if (picture.scrolls.length === 0) return
  const elements = copy.querySelectorAll('*')
  for (const [index, top, left] of picture.scrolls) {
    const element = index === -1 ? copy : elements[index]
    if (element) {
      element.scrollTop = top
      element.scrollLeft = left
    }
  }
}

/** Plays one turn over `book` (the element around the spread) from `before` to `after`.
 * Returns a function that removes the leaf at once (another turn, or the book closing). */
export function playTurn(
  book: HTMLElement,
  direction: TurnDirection,
  before: Picture,
  after: Picture,
): () => void {
  const size = book.getBoundingClientRect()
  const half = size.width / 2
  const strip = half / STRIPS
  const placed: Placed[] = []

  const clip = div('book-turn-clip')
  clip.setAttribute('aria-hidden', 'true')
  clip.inert = true
  const stage = div('book-turning')
  clip.append(stage)

  // The half the leaf falls onto keeps the old page until the leaf covers it.
  const stay = div('leaf-stay')
  stay.dataset.dir = direction
  paint(stay, before, direction === 'next' ? 0 : half, size, placed)
  stay.append(div('leaf-fall'))
  // The half the leaf lifts from is already the new page, shaded under the rising leaf.
  const reveal = div('leaf-reveal')
  reveal.dataset.dir = direction
  stage.append(stay, reveal)

  let parent: HTMLElement = stage
  for (let index = 0; index < STRIPS; index += 1) {
    const element = div(index === 0 ? 'leaf-strip book-leaf' : 'leaf-strip')
    element.dataset.dir = direction
    element.style.width = `${String(strip)}px`
    element.style.setProperty('--curl', String(curlOf(index)))
    // Strip `index` lies `index` strips from the spine: on the right page going on, on the
    // left going back; it lands mirrored on the other page.
    const near = half + index * strip
    const far = half - (index + 1) * strip
    const front = div('leaf-face leaf-front')
    paint(front, before, direction === 'next' ? near : far, size, placed, FACE_BLEED)
    front.append(div('leaf-shade'))
    const back = div('leaf-face leaf-back')
    paint(back, after, direction === 'next' ? far : near, size, placed, FACE_BLEED)
    back.append(div('leaf-shade'))
    element.append(front, back)
    parent.append(element)
    parent = element
  }

  book.append(clip)
  book.dataset.turning = ''
  placed.forEach(restoreScrolls)

  let done = false
  const finish = () => {
    if (done) return
    done = true
    window.clearTimeout(timer)
    clip.remove()
    delete book.dataset.turning
  }
  const timer = window.setTimeout(finish, TURN_MS + 150)
  const root = stage.querySelector('.book-leaf')
  root?.addEventListener('animationend', (event) => {
    if (event.target === root) finish()
  })
  return finish
}
