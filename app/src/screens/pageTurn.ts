// A leaf of soft paper turning over the spine (§12 S1 book). The leaf is cut into narrow strips
// hinged one on the next. The part at the spine turns first and each strip further out follows
// a little later, so the free edge is dragged along behind and lands last. Its front is a
// picture of the page being turned, its back the page it lands on; the half it has not covered
// yet keeps showing the old page. Post-it notes stuck in the turned pages turn with the leaf.
// Pictures are inert copies of the DOM.

export type TurnDirection = 'next' | 'prev'

/** Strips per leaf: more bend more smoothly, each costs two copies of the spread. */
const STRIPS = 12
/** Share of the turn by which the free edge starts after the spine (0 = a stiff board). */
const DRAG = 0.38
/** Samples per strip for its keyframes. */
const SAMPLES = 30
/** How dark a strip gets standing on edge to the lamp (its shade's opacity at 90°). */
const SHADE = 0.2
/** How far each leaf face reaches over its neighbours (.leaf-face in book.css). */
const FACE_BLEED = 1
/** When the back faces are pictured: before the first of them turns toward the reader, late
 * enough that the new page has drawn (React Flow measures and fits its graph after the first
 * paint). */
const BACK_PAINT_MS = 180
/** The whole turn; --turn-time in book.css matches it. */
export const TURN_MS = 750

/** The spread as it looks now, to draw on a leaf. */
export type Picture = {
  node: HTMLElement
  /** [element index in document order, scrollTop, scrollLeft] for every scrolled element
   * (-1 = the spread itself): copies lose their scroll positions. */
  scrolls: [number, number, number][]
}

/** Post-it notes stuck in the pages being turned: copies as they were (the leaf's front) and
 * the sections, whose notes as they are now go on its back. */
export type CarriedNotes = { before: HTMLElement[]; sections: string[] }

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

/** A copy of `picture` inside `box` (under what the box already holds), shifted so the box
 * shows the spread from `offset` on; `bleed` = how far the box starts before that (leaf faces
 * overlap their neighbours). */
function paint(
  box: HTMLElement,
  picture: Picture,
  offset: number,
  size: DOMRect,
  out: Placed[],
  bleed = 0,
) {
  const copy = picture.node.cloneNode(true) as HTMLElement
  // Never focused; the turning stage over it takes the pointer (book.css).
  copy.inert = true
  copy.style.cssText = `position:absolute;top:0;left:${String(bleed - offset)}px;width:${String(size.width)}px;height:${String(size.height)}px;margin:0`
  box.prepend(copy)
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

/** Angle (deg, 0 = flat where it started, 180 = flat on the other page) of strip `index` at
 * `time` (0–1): eased, each strip starting a little after the one nearer the spine. */
function angleOf(index: number, time: number): number {
  const start = DRAG * (index / (STRIPS - 1))
  const progress = Math.min(Math.max((time - start) / (1 - DRAG), 0), 1)
  return 180 * (0.5 - 0.5 * Math.cos(Math.PI * progress))
}

/** Each strip's keyframes: its turn relative to the strip it hangs on (nested transforms add
 * up), and its shade, darkest standing on edge. */
function keyframesOf(index: number, sign: number): { turn: Keyframe[]; shade: Keyframe[] } {
  const turn: Keyframe[] = []
  const shade: Keyframe[] = []
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const time = sample / SAMPLES
    const angle = angleOf(index, time)
    const relative = index === 0 ? angle : angle - angleOf(index - 1, time)
    turn.push({ offset: time, transform: `rotateY(${String(sign * relative)}deg)` })
    shade.push({ offset: time, opacity: SHADE * Math.sin((angle * Math.PI) / 180) })
  }
  return { turn, shade }
}

/** A post-it copy that turns with the leaf's outer strip; the back one is turned over, so it
 * shows unmirrored where the note sits once the leaf has landed. */
function carriedNote(note: HTMLElement, edge: 'left' | 'right', back: boolean): HTMLElement {
  const copy = note.cloneNode(true) as HTMLElement
  copy.removeAttribute('aria-current')
  copy.inert = true
  copy.classList.add('leaf-note')
  // At the strip's outer edge, as on the page.
  copy.style.left = edge === 'right' ? 'calc(100% - 12px)' : 'auto'
  copy.style.right = edge === 'left' ? 'calc(100% - 12px)' : 'auto'
  if (back) {
    // The open note sticks out 10px further; turned over, that is the other way.
    const out = note.dataset.side === 'open' ? ' translateX(-10px)' : ''
    copy.style.transform = `rotateY(180deg)${out}`
  }
  return copy
}

/** Plays one turn over `book` (the element around the spread) from `before` to the page shown
 * now, pictured by `after` once it has drawn. Returns a function that removes the leaf at once
 * (another turn, the book closing, or a click on the book while it turns). */
export function playTurn(
  book: HTMLElement,
  direction: TurnDirection,
  before: Picture,
  after: () => Picture | null,
  notes: CarriedNotes,
): () => void {
  const size = book.getBoundingClientRect()
  const half = size.width / 2
  const strip = half / STRIPS
  const sign = direction === 'next' ? -1 : 1
  const placed: Placed[] = []

  const clip = div('book-turn-clip')
  clip.setAttribute('aria-hidden', 'true')
  const stage = div('book-turning')
  clip.append(stage)

  // The half the leaf falls onto keeps the old page until the leaf covers it.
  const stay = div('leaf-stay')
  stay.dataset.dir = direction
  stay.append(div('leaf-fall'))
  paint(stay, before, direction === 'next' ? 0 : half, size, placed)
  // The half the leaf lifts from is already the new page, shaded under the rising leaf.
  const reveal = div('leaf-reveal')
  reveal.dataset.dir = direction
  stage.append(stay, reveal)

  const strips: HTMLElement[] = []
  const shades: HTMLElement[][] = []
  const backs: { face: HTMLElement; offset: number }[] = []
  let parent: HTMLElement = stage
  for (let index = 0; index < STRIPS; index += 1) {
    const element = div(index === 0 ? 'leaf-strip book-leaf' : 'leaf-strip')
    element.dataset.dir = direction
    element.style.width = `${String(strip)}px`
    // Strip `index` lies `index` strips from the spine: on the right page going on, on the
    // left going back; it lands mirrored on the other page.
    const near = half + index * strip
    const far = half - (index + 1) * strip
    const front = div('leaf-face leaf-front')
    const frontShade = div('leaf-shade')
    front.append(frontShade)
    paint(front, before, direction === 'next' ? near : far, size, placed, FACE_BLEED)
    const back = div('leaf-face leaf-back')
    const backShade = div('leaf-shade')
    back.append(backShade)
    backs.push({ face: back, offset: direction === 'next' ? far : near })
    element.append(front, back)
    parent.append(element)
    parent = element
    strips.push(element)
    shades.push([frontShade, backShade])
  }

  // Notes stuck in the turned pages ride on the outer strip, tucked under its paper.
  const outer = parent
  const edge = direction === 'next' ? 'right' : 'left'
  const live = notes.sections.flatMap((section) => {
    const note = book.querySelector<HTMLElement>(`.book-notes [data-section='${section}']`)
    return note ? [note] : []
  })
  outer.prepend(
    ...notes.before.map((note) => carriedNote(note, edge, false)),
    ...live.map((note) => carriedNote(note, edge, true)),
  )
  // The notes themselves show again where they now sit once the leaf has landed.
  for (const note of live) note.style.visibility = 'hidden'

  book.append(clip)
  placed.forEach(restoreScrolls)

  let done = false
  const animations: Animation[] = []
  const finish = () => {
    if (done) return
    done = true
    window.clearTimeout(timer)
    window.clearTimeout(backTimer)
    for (const animation of animations) animation.cancel()
    for (const note of live) note.style.visibility = ''
    clip.remove()
  }
  const timer = window.setTimeout(finish, TURN_MS + 150)
  const backTimer = window.setTimeout(() => {
    const picture = after()
    if (done || !picture) return
    const painted: Placed[] = []
    for (const { face, offset } of backs) paint(face, picture, offset, size, painted, FACE_BLEED)
    painted.forEach(restoreScrolls)
  }, BACK_PAINT_MS)

  // jsdom has no Web Animations; there the leaf just waits for the timer.
  if (typeof stage.animate === 'function') {
    const timing: KeyframeAnimationOptions = { duration: TURN_MS, fill: 'both' }
    strips.forEach((element, index) => {
      const { turn, shade } = keyframesOf(index, sign)
      animations.push(element.animate(turn, timing))
      for (const face of shades[index] ?? []) animations.push(face.animate(shade, timing))
    })
    const last = animations[animations.length - 1]
    if (last) last.onfinish = finish
  }
  // A click on the book while it turns ends the turn instead of reaching the page under the
  // pictures of the old one.
  stage.addEventListener('pointerdown', () => {
    finish()
  })
  return finish
}
