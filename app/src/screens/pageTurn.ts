// Leaves of soft paper turning over the spine (§12 S1 book). A leaf is cut into narrow strips
// hinged one on the next. The part at the spine turns first and each strip further out follows
// a little later, so the free edge is dragged along behind and lands last. Turning past several
// sections turns one leaf per section, each a moment after the one before, as a reader's thumb
// lets pages go. The first leaf's front is a picture of the page being turned, the last one's
// back the page it lands on (the leaves between are blank paper); the half no leaf has covered
// yet keeps showing the old page. Each leaf carries its own section's post-it. Everything that
// moves is a transform or an opacity, so the compositor alone draws the turn. Pictures are inert
// copies of the DOM.

export type TurnDirection = 'next' | 'prev'

/** Strips per leaf: more bend more smoothly, each costs two copies of the spread. */
const STRIPS = 12
/** Share of the turn by which the free edge starts after the spine (0 = a stiff board). */
const DRAG = 0.38
/** Samples per strip for its keyframes. */
const SAMPLES = 60
/** How dark a strip gets standing on edge to the lamp (its shade's opacity at 90°). */
const SHADE = 0.2
/** The shadow a leaf casts beyond its outer part: darkest (at most CAST) a little above the
 * page, fading as it rises; its soft edge widens with the height. */
const CAST = 0.3
const castOf = (height: number, half: number) =>
  CAST * Math.min(1, height / 24) * Math.max(0.2, 1 - height / (half * 0.8))
const penumbraOf = (height: number) => 14 + height * 0.18
/** A cast shadow's own width; keyframes scale it (.leaf-cast in book.css). */
const CAST_BOX = 100
/** The gutter darkens while the first leaf stands over it (at most GUTTER, upright). */
const GUTTER = 0.16
/** How far each leaf face reaches over its neighbours (.leaf-face in book.css). */
const FACE_BLEED = 1
/** When the back faces are pictured: before the first of them turns toward the reader, late
 * enough that the new page has drawn (React Flow measures and fits its graph after the first
 * paint). */
const BACK_PAINT_MS = 180
/** One leaf's turn; --turn-time in book.css matches it. */
export const TURN_MS = 750
/** How long after one leaf the next lets go, turning past several sections. */
export const STAGGER_MS = 140
/** The whole turn of `leaves` leaves. */
export const turnTime = (leaves: number) => TURN_MS + (Math.max(leaves, 1) - 1) * STAGGER_MS
/** Once landed, the leaves (3D pictures: their text and edges sit a fraction of a pixel off
 * the page's) fade into the page under them instead of being swapped for it. */
const SETTLE_MS = 160

/** The spread as it looks now, to draw on a leaf. */
export type Picture = {
  node: HTMLElement
  /** [element index in document order, scrollTop, scrollLeft] for every scrolled element
   * (-1 = the spread itself): copies lose their scroll positions. */
  scrolls: [number, number, number][]
}

/** Post-it notes stuck in the pages being turned, one per leaf in the order they turn: copies
 * as they were with where they were on screen (the leaf's front) and the sections, whose notes
 * as they are now go on its back; and every note's stacking level (z-index) before the turn. */
export type CarriedNotes = {
  before: { copy: HTMLElement; rect: DOMRect }[]
  sections: string[]
  /** How far (px) the open pages glide right while the leaves turn. */
  slide: number
  levels: ReadonlyMap<string, number>
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
  copy.style.cssText = `position:absolute;top:0;left:${String(bleed - offset)}px;width:${String(size.width)}px;height:${String(size.height)}px;margin:0;translate:none;transition:none`
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

/** A leaf's shadows over its turn. At each moment the strips' angles give the leaf's outline
 * seen from above: how far it reaches over each side of the spine, and how high its outermost
 * part there stands. Beyond that part a soft shadow falls on the page below. */
function shadowFramesOf(
  widths: number[],
  spine: number,
  direction: TurnDirection,
): { left: Keyframe[]; right: Keyframe[]; gutter: Keyframe[] } {
  const half = widths.reduce((sum, width) => sum + width, 0)
  const left: Keyframe[] = []
  const right: Keyframe[] = []
  const gutter: Keyframe[] = []
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const time = sample / SAMPLES
    // Out from the spine: + over the side it starts on, - over the side it lands on.
    let along = 0
    let height = 0
    let start = { reach: 0, height: 0 }
    let land = { reach: 0, height: 0 }
    widths.forEach((width, index) => {
      const angle = (angleOf(index, time) * Math.PI) / 180
      along += width * Math.cos(angle)
      height += width * Math.sin(angle)
      if (along > start.reach) start = { reach: along, height }
      if (-along > land.reach) land = { reach: -along, height }
    })
    // Screen sides: going on, it starts over the right page; going back, over the left.
    const onRight = direction === 'next' ? start : land
    const onLeft = direction === 'next' ? land : start
    const band = (over: { reach: number; height: number }, side: 'left' | 'right') => {
      const width = penumbraOf(over.height)
      const at = side === 'right' ? spine + over.reach : spine - over.reach - width
      return {
        offset: time,
        transform: `translateX(${String(at)}px) scaleX(${String(width / CAST_BOX)})`,
        opacity: over.reach > 0 ? castOf(over.height, half) : 0,
      }
    }
    right.push(band(onRight, 'right'))
    left.push(band(onLeft, 'left'))
    gutter.push({ offset: time, opacity: GUTTER * Math.sin((angleOf(0, time) * Math.PI) / 180) })
  }
  return { left, right, gutter }
}

/** A post-it copy that turns with a leaf's outer strip; the back one is turned over, so it
 * shows unmirrored where the note sits once the leaf has landed. */
function carriedNote(note: HTMLElement, left: number, back: boolean): HTMLElement {
  // (Its place over or under the leaf's paper is set by where playTurn puts it.)
  const copy = note.cloneNode(true) as HTMLElement
  copy.removeAttribute('aria-current')
  copy.inert = true
  copy.classList.add('leaf-note')
  // Shown on the leaf even when copied from a note hidden by a turn still running.
  copy.style.opacity = ''
  // Where the note is on the page, in the outer strip's own frame.
  copy.style.left = `${String(left)}px`
  copy.style.right = 'auto'
  if (back) copy.style.transform = 'rotateY(180deg)'
  return copy
}

type Leaf = {
  /** Holds the leaf's own 3D view; its z-index puts it over or under the other leaves. */
  wrap: HTMLElement
  strips: HTMLElement[]
  shades: HTMLElement[][]
  backs: { face: HTMLElement; offset: number }[]
}

/** Plays one turn over `book` (the element around the spread) from `before` to the page shown
 * now, pictured by `after` once it has drawn: one leaf per section in `notes.sections`.
 * Returns a function that removes the leaves at once (another turn, the book closing, or a
 * click on the book while it turns). */
export function playTurn(
  book: HTMLElement,
  direction: TurnDirection,
  before: Picture,
  after: () => Picture | null,
  notes: CarriedNotes,
): () => void {
  const size = book.getBoundingClientRect()
  // Whole pixels from the book's left for the spine and every strip edge: a picture at a
  // fraction of a pixel draws its text and edges a hair off the page it stands for.
  const spine = Math.round(size.width / 2)
  const width = Math.round(size.width)
  /** Edge `k` of a leaf, counted out from the spine (0) to the free edge (STRIPS). */
  const edge = (k: number) =>
    direction === 'next'
      ? Math.round(spine + ((width - spine) * k) / STRIPS)
      : Math.round(spine - (spine * k) / STRIPS)
  const sign = direction === 'next' ? -1 : 1
  const count = Math.max(notes.sections.length, 1)
  const total = turnTime(count)
  const placed: Placed[] = []

  const clip = div('book-turn-clip')
  clip.setAttribute('aria-hidden', 'true')
  const stage = div('book-turning')
  clip.append(stage)

  // The half the leaves fall onto keeps the old page until they cover it.
  const stay = div('leaf-stay')
  stay.dataset.dir = direction
  if (direction === 'next') stay.style.width = `${String(spine)}px`
  else stay.style.left = `${String(spine)}px`
  paint(stay, before, direction === 'next' ? 0 : spine, size, placed)
  // Shadows on the pages under the leaves: beyond each leaf's outer part on each side of the
  // spine (it is over one side, then the other), and the gutter's while the first one stands.
  const shadows = div('leaf-shadows')
  const casts = Array.from({ length: count }, () => {
    const left = div('leaf-cast')
    left.dataset.side = 'left'
    const right = div('leaf-cast')
    right.dataset.side = 'right'
    shadows.append(left, right)
    return { left, right }
  })
  const gutter = div('leaf-gutter')
  gutter.style.left = `${String(spine)}px`
  shadows.append(gutter)
  stage.append(stay, shadows)

  const leaves: Leaf[] = Array.from({ length: count }, (_, at) => {
    const wrap = div('leaf')
    const strips: HTMLElement[] = []
    const shades: HTMLElement[][] = []
    const backs: { face: HTMLElement; offset: number }[] = []
    let parent: HTMLElement = wrap
    for (let index = 0; index < STRIPS; index += 1) {
      const element = div(index === 0 ? 'leaf-strip book-leaf' : 'leaf-strip')
      element.dataset.dir = direction
      // Strip `index` runs from edge `index` to edge `index + 1`: on the right page going on,
      // on the left going back. It lands mirrored about the spine on the other page.
      const from = edge(index)
      const to = edge(index + 1)
      element.style.width = `${String(Math.abs(to - from))}px`
      if (index === 0) {
        if (direction === 'next') element.style.left = `${String(spine)}px`
        else element.style.right = `${String(width - spine)}px`
      }
      const front = div('leaf-face leaf-front')
      const frontShade = div('leaf-shade')
      front.append(frontShade)
      // Only the first leaf shows the page being turned; the others are the pages between.
      if (at === 0) paint(front, before, Math.min(from, to), size, placed, FACE_BLEED)
      const back = div('leaf-face leaf-back')
      const backShade = div('leaf-shade')
      back.append(backShade)
      backs.push({ face: back, offset: 2 * spine - Math.max(from, to) })
      element.append(front, back)
      parent.append(element)
      parent = element
      strips.push(element)
      shades.push([frontShade, backShade])
    }
    stage.append(wrap)
    return { wrap, strips, shades, backs }
  })

  // Each leaf carries its own section's note on its outer strip: the open section's over its
  // paper, the others tucked under it (as on the page; coplanar, so DOM order decides).
  const live = notes.sections.map((section) =>
    book.querySelector<HTMLElement>(`.book-notes [data-section='${section}']`),
  )
  // On screen: the open pages and the outer strip's left edge as the turn starts. A front copy
  // sits where its note was; a back copy where, once the strip has turned over the spine (and
  // glided `slide` with the open pages), it lands on its note.
  const pagesAt = (book.querySelector(':scope > .spread') ?? book).getBoundingClientRect().left
  const stripAt = pagesAt + (direction === 'next' ? edge(STRIPS - 1) : edge(STRIPS))
  const spineAt = pagesAt + spine
  const landing = (rect: DOMRect) => 2 * spineAt + notes.slide - rect.left - rect.width - stripAt
  leaves.forEach((leaf, at) => {
    const outer = leaf.strips[STRIPS - 1]
    if (!outer) return
    const was = notes.before[at]
    const now = live[at]
    const copies: [HTMLElement, HTMLElement][] = []
    if (was) copies.push([was.copy, carriedNote(was.copy, was.rect.left - stripAt, false)])
    if (now) copies.push([now, carriedNote(now, landing(now.getBoundingClientRect()), true)])
    for (const [note, copy] of copies) {
      if (note.dataset.side === 'open') outer.append(copy)
      else outer.prepend(copy)
    }
  })
  const turned = live.filter((note): note is HTMLElement => note !== null)
  // The notes themselves show again where they now sit once the leaves have landed (opacity,
  // not visibility: a focused note keeps the focus).
  for (const note of turned) note.style.opacity = '0'
  // A note that now lies under the page it was over (the open section's, turning back) stays
  // over it until the leaves have come down on it.
  const held = [...book.querySelectorAll<HTMLElement>('.book-notes [data-section]')].filter(
    (note) => {
      const was = notes.levels.get(note.dataset.section ?? '')
      const now = Number(getComputedStyle(note).zIndex)
      if (turned.includes(note) || was === undefined || !(was > now)) return false
      note.style.zIndex = String(was)
      return true
    },
  )
  const release = () => {
    for (const note of turned) note.style.opacity = ''
    for (const note of held) note.style.zIndex = ''
  }

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
    release()
    clip.remove()
    book.style.removeProperty('--glide')
  }
  const timer = window.setTimeout(finish, total + SETTLE_MS + 150)
  /** The last leaf has landed: the old page under them goes, the notes show where they now
   * sit, and the leaves fade into the page. */
  const settle = () => {
    if (done) return
    stay.remove()
    release()
    const fade = clip.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: SETTLE_MS,
      easing: 'ease-out',
      fill: 'forwards',
    })
    animations.push(fade)
    fade.onfinish = finish
  }
  // The last leaf's back is the page landed on.
  const lastLeaf = leaves[count - 1]
  const backTimer = window.setTimeout(
    () => {
      const picture = after()
      if (done || !picture || !lastLeaf) return
      const painted: Placed[] = []
      for (const { face, offset } of lastLeaf.backs)
        paint(face, picture, offset, size, painted, FACE_BLEED)
      painted.forEach(restoreScrolls)
    },
    BACK_PAINT_MS + (count - 1) * STAGGER_MS,
  )

  // jsdom has no Web Animations; there the leaves just wait for the timer.
  if (typeof stage.animate === 'function') {
    const widths = Array.from({ length: STRIPS }, (_, k) => Math.abs(edge(k + 1) - edge(k)))
    const shadow = shadowFramesOf(widths, spine, direction)
    // Over the spine the leaves change places: one still to turn lies under the one turning
    // before it; once over, it lies on the ones turned before it.
    const crossing = 0.5 * (1 - DRAG)
    leaves.forEach((leaf, at) => {
      const timing: KeyframeAnimationOptions = {
        duration: TURN_MS,
        delay: at * STAGGER_MS,
        fill: 'both',
      }
      leaf.strips.forEach((element, index) => {
        const { turn, shade } = keyframesOf(index, sign)
        animations.push(element.animate(turn, timing))
        for (const face of leaf.shades[index] ?? []) animations.push(face.animate(shade, timing))
      })
      animations.push(
        leaf.wrap.animate(
          [
            { offset: 0, zIndex: count - at },
            { offset: crossing, zIndex: count - at },
            { offset: crossing + 0.001, zIndex: count + 1 + at },
            { offset: 1, zIndex: count + 1 + at },
          ],
          timing,
        ),
      )
      const cast = casts[at]
      if (cast)
        animations.push(
          cast.left.animate(shadow.left, timing),
          cast.right.animate(shadow.right, timing),
        )
    })
    animations.push(gutter.animate(shadow.gutter, { duration: TURN_MS, fill: 'both' }))
    // A new element gets no CSS transition: it glides from where the open pages were, in step
    // with their own transition (book.css .spread, timed by --glide).
    animations.push(
      stage.animate(
        [{ transform: `translateX(${String(-notes.slide)}px)` }, { transform: 'none' }],
        { duration: total, easing: 'ease-in-out', fill: 'both' },
      ),
    )
    // The last leaf to land (its last strip's turn is the last to end) settles the turn.
    const lastStrip = lastLeaf?.strips[STRIPS - 1]
    const ending = animations.find((animation) => {
      const effect = animation.effect
      return effect instanceof KeyframeEffect && effect.target === lastStrip
    })
    if (ending) ending.onfinish = settle
  }
  // A click on the book while it turns ends the turn instead of reaching the page under the
  // pictures of the old one.
  stage.addEventListener('pointerdown', () => {
    finish()
  })
  return finish
}
