// Leaves of soft paper turning over the spine (§12 S1 book). A leaf is cut into narrow strips
// hinged one on the next. The whole leaf lifts and lands together, the part further out lagging
// a little behind in between, so the paper curls without its free edge being dragged flat
// across the page or spreading out late as it lands. Turning past several
// sections turns one leaf per section, each a moment after the one before, as a reader's thumb
// lets pages go. The first leaf's front is a picture of the page being turned, the last one's
// back the page it lands on (the leaves between are blank paper); the half no leaf has covered
// yet keeps showing the old page. The new page lies where it belongs from the start; each leaf
// carries its own section's post-it and page edge, and shifts the open pages' 3px per section
// while it is in the air. Everything that
// moves is a transform or an opacity, so the compositor alone draws the turn. Pictures are inert
// copies of the DOM.

export type TurnDirection = 'next' | 'prev'

/** Strips per leaf: more bend more smoothly, each costs two copies of the spread. */
const STRIPS = 16
/** How far (deg) the free edge lags behind the spine half way over (0 = a stiff board). */
const CURL = 30
/** Samples per strip for its keyframes. */
const SAMPLES = 60
/** How far (px) a leaf's free edge draws back off a note before the pages' shadow on it is gone. */
const SHADE_FADE = 40
/** How dark a strip gets standing on edge to the lamp (its shade's opacity at 90°). */
const SHADE = 0.2
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
  /** How far (px) right the open pages lie after the turn than before (3px per section). */
  slide: number
  /** The open section (its index) before the turn. */
  from: number
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
 * `time` (0–1): eased, each strip further out lagging a little more behind the spine, most half
 * way over and not at all as it lifts and lands (always turning on, never back). */
function angleOf(index: number, time: number): number {
  const progress = Math.min(Math.max(time, 0), 1)
  const spine = 180 * (0.5 - 0.5 * Math.cos(Math.PI * progress))
  const lag = CURL * (index / (STRIPS - 1)) * Math.sin((spine * Math.PI) / 180)
  return spine - lag
}

/** How far (px) the free edge of a leaf whose strips are `widths` wide reaches out from the
 * spine at `time` (0–1 of its turn), seen from above (no perspective): negative once over it. */
function reachOf(widths: number[], time: number): number {
  return widths.reduce(
    (sum, width, index) => sum + width * Math.cos((angleOf(index, time) * Math.PI) / 180),
    0,
  )
}

/** How much of the open pages' shadow (contents.css .spread: a 40px blur, a Gaussian of σ 20px)
 * falls `distance` px beyond their edge, 0–1: Φ(−d/σ) = erfc(d / σ√2) / 2, erfc after
 * Abramowitz–Stegun 7.1.26. */
function pageShadeAt(distance: number): number {
  const x = Math.abs(distance) / (20 * Math.SQRT2)
  const t = 1 / (1 + 0.3275911 * x)
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erfc = poly * Math.exp(-x * x)
  return distance >= 0 ? erfc / 2 : 1 - erfc / 2
}

/** How far over (0–1) a leaf has shifted at `time` (0–1 of its turn): with the spine's height,
 * so it shifts while in the air and never while it lies on a page. */
const shiftOf = (time: number) => 0.5 - 0.5 * Math.cos((angleOf(0, time) * Math.PI) / 180)

/** How dark the paper is where two strips meet (edge `k`, 0 = the spine): lit by the angle
 * halfway between them, so the shade runs on smoothly from one strip to the next. */
function shadeAt(k: number, time: number): number {
  const before = angleOf(Math.max(k - 1, 0), time)
  const after = angleOf(Math.min(k, STRIPS - 1), time)
  return SHADE * Math.sin((((before + after) / 2) * Math.PI) / 180)
}

/** Each strip's keyframes: its turn relative to the strip it hangs on (nested transforms add
 * up), and its shade at its inner and outer edges (a face blends the two across itself). */
function keyframesOf(
  index: number,
  sign: number,
): { turn: Keyframe[]; inner: Keyframe[]; outer: Keyframe[] } {
  const turn: Keyframe[] = []
  const inner: Keyframe[] = []
  const outer: Keyframe[] = []
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const time = sample / SAMPLES
    const angle = angleOf(index, time)
    const relative = index === 0 ? angle : angle - angleOf(index - 1, time)
    turn.push({ offset: time, transform: `rotateY(${String(sign * relative)}deg)` })
    inner.push({ offset: time, opacity: shadeAt(index, time) })
    outer.push({ offset: time, opacity: shadeAt(index + 1, time) })
  }
  return { turn, inner, outer }
}

/** Where a box is on screen. */
type Box = { left: number; top: number; width: number; height: number }

/** Its shadow (book.css .book-note) shows wherever a note does. */
const NOTE_SHADOW = 10

/** A post-it copy in a window (book.css .note-window) that cuts off what the leaves still lie
 * over: the window slides over the copy while the copy slides back the other way, so only
 * transforms move. `base` places it among the leaf's paper (a back copy is turned over, so it
 * shows unmirrored where the note sits once the leaf has landed); the window has room for the
 * note's shadow all round and, on the side the leaves cover it from, for sliding over it. */
type Windowed = { win: HTMLElement; copy: HTMLElement; base: string; box: Box }

function windowed(note: HTMLElement, rect: Box, side: 'left' | 'right', base: string): Windowed {
  const copy = note.cloneNode(true) as HTMLElement
  copy.removeAttribute('aria-current')
  copy.inert = true
  copy.classList.add('leaf-note')
  // Shown even when copied from a note hidden by a turn.
  copy.style.opacity = ''
  const room = rect.width + NOTE_SHADOW
  const before = side === 'left' ? room : 0
  copy.style.left = `${String(NOTE_SHADOW + before)}px`
  copy.style.top = `${String(NOTE_SHADOW)}px`
  copy.style.right = 'auto'
  const box = {
    left: rect.left - NOTE_SHADOW - before,
    top: rect.top - NOTE_SHADOW,
    width: rect.width + 2 * NOTE_SHADOW + room,
    height: rect.height + 2 * NOTE_SHADOW,
  }
  const win = div('note-window')
  win.style.width = `${String(box.width)}px`
  win.style.height = `${String(box.height)}px`
  win.style.transform = base
  win.append(copy)
  return { win, copy, base, box }
}

/** Section `section`'s page as it shows past a leaf's free edge (or past the new open page):
 * `width` px of paper at `left` in the leaf's outer strip (or the stage), on its back if
 * `back`, ending in `band` px of its page edge (book.css .book-edge) on the outer side (`side`),
 * behind the post-its riding there. Where it shows in the page block it lies in the open pages'
 * shadow, from `near` px past their edge. `fold` takes the leaf's shading as it bends. */
function pageEdge(
  section: number,
  left: number,
  back: boolean,
  width: number,
  band: number,
  shade: { side: 'left' | 'right'; near: number },
): { strip: HTMLElement; fold: HTMLElement } {
  const strip = div('leaf-edge')
  if (section % 2 === 1) strip.dataset.even = 'true'
  strip.style.left = `${String(left)}px`
  strip.style.width = `${String(width)}px`
  strip.style.transform = `${back ? 'rotateY(180deg) ' : ''}translateZ(-2px)`
  strip.style.backgroundImage = `${
    shade.side === 'right'
      ? `linear-gradient(90deg, transparent calc(100% - ${String(band)}px), var(--band) 0)`
      : `linear-gradient(90deg, var(--band) ${String(band)}px, transparent 0)`
  }, linear-gradient(var(--paper), var(--paper))`
  const share = (x: number) => {
    const distance = shade.side === 'right' ? shade.near + x : shade.near + width - x
    const percent = Math.round(pageShadeAt(distance) * 1000) / 10
    return `color-mix(in srgb, var(--wood-shadow) ${String(percent)}%, transparent) ${String(x)}px`
  }
  const stops = Array.from({ length: Math.ceil(width / 3) + 1 }, (_, at) =>
    share(Math.min(at * 3, width)),
  )
  const over = div('leaf-edge-shade')
  over.style.background = `linear-gradient(90deg, ${stops.join(', ')})`
  const fold = div('leaf-edge-fold')
  strip.append(over, fold)
  return { strip, fold }
}

/** A face's shading: two gradients, one darkest at the strip's inner edge and one at its
 * outer edge, their opacities set from the paper's angle there. */
type Shades = { inner: HTMLElement; outer: HTMLElement }

type Leaf = {
  /** Holds the leaf's own 3D view; its z-index puts it over or under the other leaves. */
  wrap: HTMLElement
  strips: HTMLElement[]
  shades: Shades[]
  backs: { face: HTMLElement; offset: number; bleed: number }[]
  /** Its pages past its free edge, shaded as its outer strip. */
  folds: HTMLElement[]
}

/** How a note, or its copy on a leaf, is covered while the leaves turn: by the paper of a leaf
 * over it (lifting off it, or coming down on it) and the page edges turning with that leaf,
 * and shaded by the open pages while it lies under them. */
type Track = {
  /** Its left edge on screen `ms` into the turn, and its width. */
  leftAt: (ms: number) => number
  span: number
  /** The side of the book it sticks out of. */
  side: 'left' | 'right'
  /** The leaf over it, and whether it lies under that leaf as the turn starts (the leaf lifts
   * off it) or as it ends (the leaf comes down on it). */
  by: number
  covered: 'start' | 'end'
  /** How far past that leaf's free edge it is covered (the page edges of the sections between,
   * turning with the leaf), or null when its own leaf's paper covers it already. */
  bands: number | null
  /** The open pages' edge beside it while it is covered: the page edges there never move, and
   * the pages' shadow is darkest there. */
  edge: number
}

/** The leaves as a turn plays them: its length, a leaf's strip widths, and `ms` into it how far
 * leaf `by`'s free edge reaches out from the spine and where on screen it is. */
type LeafAt = {
  total: number
  widths: number[]
  reach: (by: number, ms: number) => number
  edge: (by: number, ms: number) => number
}

/** Animates `target` through `steps`, its look at each of `times` (ms into the turn), running
 * only while the look changes: before that it holds the first, after that the last. */
function animateChanges(
  target: HTMLElement,
  times: number[],
  steps: Keyframe[],
  pseudoElement?: string,
): Animation {
  const same = (a: number, b: number) => JSON.stringify(steps[a]) === JSON.stringify(steps[b])
  const end = steps.length - 1
  let first = 0
  while (first < end && same(first + 1, 0)) first += 1
  let last = end
  while (last > first + 1 && same(last - 1, end)) last -= 1
  const from = times[first] ?? 0
  const duration = Math.max((times[last] ?? 0) - from, 1)
  const changing = steps
    .slice(first, last + 1)
    .map((step, at) => ({ ...step, offset: ((times[first + at] ?? from) - from) / duration }))
  return target.animate(changing, { delay: from, duration, fill: 'both', pseudoElement })
}

/** Animates a windowed note's cut and shade along `track`; returns the animations. */
function followLeaf({ win, copy, base }: Windowed, track: Track, leaf: LeafAt): Animation[] {
  const frames = Math.ceil(leaf.total / 8)
  const flat = leaf.widths.reduce((sum, width) => sum + width, 0)
  const times = Array.from({ length: frames + 1 }, (_, frame) => (leaf.total * frame) / frames)
  const out: Animation[] = []
  const { bands } = track
  // Covered from the open pages' side up to the leaf's edge (no further than the open pages'
  // while the leaf lies on them: the page edges beside them stay put); the window slides over
  // that far (into the room on its other side), the note back.
  const toward = track.side === 'right' ? 1 : -1
  const shifts = times.map((ms) => {
    if (bands === null) return 0
    const free = leaf.edge(track.by, ms)
    const left = track.leftAt(ms)
    const hidden =
      track.side === 'right'
        ? Math.min(track.edge, free) + bands - left
        : left + track.span - (Math.max(track.edge, free) - bands)
    return toward * Math.max(hidden + NOTE_SHADOW, 0)
  })
  if (bands !== null) {
    out.push(
      animateChanges(
        win,
        times,
        times.map((_, frame) => ({
          transform: `${base} translateX(${String(shifts[frame] ?? 0)}px)`,
        })),
      ),
      animateChanges(
        copy,
        times,
        shifts.map((shift) => ({ transform: `translateX(${String(-shift)}px)` })),
      ),
    )
  }
  // Under the open pages it lies in their shadow, darkest at their edge (no darker over the
  // part they hide), which goes as the leaf's free edge draws back off it, or comes as it
  // comes down.
  const left = track.leftAt(track.covered === 'start' ? 0 : leaf.total)
  const stops = Array.from({ length: Math.ceil(track.span / 4) + 1 }, (_, at) => {
    const x = Math.min(at * 4, track.span)
    const beyond = track.side === 'right' ? left + x - track.edge : track.edge - left - x
    const share = Math.round(pageShadeAt(Math.max(beyond, 0)) * 1000) / 10
    return `color-mix(in srgb, var(--wood-shadow) ${String(share)}%, transparent) ${String(x)}px`
  })
  copy.style.setProperty('--page-shade', `linear-gradient(90deg, ${stops.join(', ')})`)
  const shade: Keyframe[] = times.map((ms) => {
    // How far the free edge is from lying flat over it (reaching `flat` out from the spine on
    // the side the leaf starts on, −`flat` on the side it lands on).
    const reach = leaf.reach(track.by, ms)
    const away = track.covered === 'start' ? flat - reach : flat + reach
    return { opacity: Math.round(Math.max(1 - away / SHADE_FADE, 0) * 1000) / 1000 }
  })
  out.push(animateChanges(copy, times, shade, '::after'))
  return out
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
  const widths = Array.from({ length: STRIPS }, (_, index) =>
    Math.abs(edge(index + 1) - edge(index)),
  )
  // The new open pages, where they lie for good.
  const pages = book.querySelector<HTMLElement>(':scope > .spread')
  const pagesRect = (pages ?? book).getBoundingClientRect()
  // The page edge of one section (book.css .book-edge).
  const step = Math.abs(notes.slide) / count

  const clip = div('book-turn-clip')
  clip.setAttribute('aria-hidden', 'true')
  const stage = div('book-turning')
  clip.append(stage)

  // The half the leaves fall onto keeps the old page where it lay until they cover it (the
  // stage is where the new page lies).
  const stay = div('leaf-stay')
  stay.dataset.dir = direction
  if (direction === 'next') stay.style.width = `${String(spine)}px`
  else stay.style.left = `${String(spine)}px`
  stay.style.transform = `translateX(${String(-notes.slide)}px)`
  paint(stay, before, direction === 'next' ? 0 : spine, size, placed)
  stage.append(stay)

  const leaves: Leaf[] = Array.from({ length: count }, (_, at) => {
    const wrap = div('leaf')
    const strips: HTMLElement[] = []
    const shades: Shades[] = []
    const backs: { face: HTMLElement; offset: number; bleed: number }[] = []
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
      // In a face's own frame, which side is the strip's inner edge: going on, the front's left;
      // going back, its right; a back face is mirrored.
      const shading = (face: HTMLElement, innerLeft: boolean): Shades => {
        const inner = div('leaf-shade')
        inner.dataset.from = innerLeft ? 'left' : 'right'
        const outer = div('leaf-shade')
        outer.dataset.from = innerLeft ? 'right' : 'left'
        face.append(inner, outer)
        return { inner, outer }
      }
      // The outer strip's faces reach no further than the free edge (the page edge beyond it
      // shows through): on the right going on, on the left going back.
      const end = index === STRIPS - 1 ? ' leaf-face-free' : ''
      const bleed = end && direction === 'prev' ? 0 : FACE_BLEED
      const front = div(`leaf-face leaf-front${end}`)
      const frontShades = shading(front, direction === 'next')
      // Only the first leaf shows the page being turned; the others are the pages between.
      if (at === 0) paint(front, before, Math.min(from, to), size, placed, bleed)
      const back = div(`leaf-face leaf-back${end}`)
      const backShades = shading(back, direction !== 'next')
      backs.push({ face: back, offset: 2 * spine - Math.max(from, to), bleed })
      element.append(front, back)
      parent.append(element)
      parent = element
      strips.push(element)
      shades.push(frontShades, backShades)
    }
    // The leaf's own page edge (book.css .book-edge) turns with it: past its free edge where
    // it shows in the page block it leaves and where it shows in the one it lands on.
    // (The paper between its free edge and its page edge lies under the leaves before it.)
    const outer = strips[STRIPS - 1]
    const folds: HTMLElement[] = []
    if (outer) {
      const reach = Math.abs(edge(STRIPS) - edge(STRIPS - 1))
      const last = count - 1
      const going = direction === 'next'
      const own = going ? notes.from + at : notes.from - 1 - at
      // How many page edges out from the open pages' it shows: where it starts, where it lands.
      const out0 = going ? (at > 0 ? at : null) : at + 1
      const out1 = going ? last - at + 1 : at < last ? last - at : null
      const place = (out: number, back: boolean, side: 'left' | 'right') => {
        const span = step * out
        const { strip, fold } = pageEdge(own, going ? reach : -span, back, span, step, {
          side,
          near: 0,
        })
        outer.append(strip)
        folds.push(fold)
      }
      if (out0 !== null) place(out0, false, going ? 'right' : 'left')
      if (out1 !== null) place(out1, true, going ? 'left' : 'right')
    }
    stage.append(wrap)
    return { wrap, strips, shades, backs, folds }
  })

  // Each leaf carries its own section's note on its outer strip: the open section's over its
  // paper, the others tucked under it, as on the page.
  const live = notes.sections.map((section) =>
    book.querySelector<HTMLElement>(`.book-notes [data-section='${section}']`),
  )
  // On screen: the old open pages and the outer strip's left edge as the turn starts. A front
  // copy sits where its note was; a back copy where, once the strip has turned over the spine
  // (and shifted `slide` with it), it lands on its note.
  const pagesAt = pagesRect.left - notes.slide
  const stripAt = pagesAt + (direction === 'next' ? edge(STRIPS - 1) : edge(STRIPS))
  const spineAt = pagesAt + spine
  const landing = (rect: Box) => 2 * spineAt + notes.slide - rect.left - rect.width - stripAt
  /** How far over (0–1) leaf `at` has shifted `ms` into the turn. */
  const shifted = (at: number, ms: number) => shiftOf((ms - at * STAGGER_MS) / TURN_MS)
  /** How far (px) a copy riding on leaf `at` has shifted with it `ms` into the turn: from where
   * its note was (front) or to where its note is (back). */
  const glided = (at: number, ms: number, back: boolean) =>
    notes.slide * (shifted(at, ms) - (back ? 1 : 0))
  const oldEdge = { left: pagesAt, right: pagesAt + pagesRect.width }
  const newEdge = { left: pagesRect.left, right: pagesRect.right }
  const tracks: { note: Windowed; track: Track }[] = []
  type Cover = Omit<Track, 'leftAt' | 'span' | 'covered'>
  /** Leaf `at`'s note copies: the front one (where the note was) and the back one (where it
   * lands), and how the leaves cover each. Going on, the leaves lift off the right and land on
   * the left; a note lies under the leaf before its own (and the page edges of the sections
   * between, reaching past that leaf's free edge), and its own leaf's paper covers it unless it
   * is the open section's. Going back, the other way round. */
  const tracksOf = (at: number, was: DOMRect | undefined, now: DOMRect | undefined) => {
    const out: { back: boolean; track: Track }[] = []
    const add = (back: boolean, rect: DOMRect, cover: Cover) => {
      out.push({
        back,
        track: {
          ...cover,
          leftAt: (ms) => rect.left + glided(at, ms, back),
          span: rect.width,
          covered: back ? 'end' : 'start',
        },
      })
    }
    const last = count - 1
    if (direction === 'next') {
      if (was && at > 0)
        add(false, was, { side: 'right', by: at - 1, bands: step * (at - 1), edge: oldEdge.right })
      if (now)
        add(true, now, {
          side: 'left',
          by: Math.min(at + 1, last),
          bands: at < last ? step * (last - at) : null,
          edge: newEdge.left,
        })
    } else {
      if (was)
        add(false, was, {
          side: 'left',
          by: Math.max(at - 1, 0),
          bands: at > 0 ? step * at : null,
          edge: oldEdge.left,
        })
      if (now && at < last)
        add(true, now, {
          side: 'right',
          by: at + 1,
          bands: step * (last - 1 - at),
          edge: newEdge.right,
        })
    }
    return out
  }
  leaves.forEach((leaf, at) => {
    const outer = leaf.strips[STRIPS - 1]
    if (!outer) return
    const was = notes.before[at]
    const now = live[at]
    let nowRect: DOMRect | undefined
    if (now) {
      // Where it sits for good: not where its slide-in (it changed sides) has it for a moment.
      // (jsdom has no Web Animations.)
      if (typeof now.getAnimations === 'function')
        for (const animation of now.getAnimations()) animation.finish()
      nowRect = now.getBoundingClientRect()
    }
    const covers = tracksOf(at, was?.rect, nowRect)
    const place = (back: boolean, source: HTMLElement, rect: Box) => {
      const track = covers.find((cover) => cover.back === back)?.track
      // Over the leaf's paper if it is the open section's, else tucked under it: a pixel in
      // front of or behind it (on the same plane the order would be left to the renderer).
      const depth = source.dataset.side === 'open' ? 1 : -1
      const base = `${back ? 'rotateY(180deg) ' : ''}translateZ(${String(depth)}px)`
      const note = windowed(source, rect, track?.side ?? 'right', base)
      // Where the note is on the page, in the outer strip's own frame.
      note.win.style.left = `${String(back ? landing(note.box) : note.box.left - stripAt)}px`
      note.win.style.top = `${String(note.box.top - size.top)}px`
      outer.append(note.win)
      if (track) tracks.push({ note, track })
    }
    if (was) place(false, was.copy, was.rect)
    if (now && nowRect) place(true, now, nowRect)
  })
  const turned = live.filter((note): note is HTMLElement => note !== null)
  // The notes themselves show again where they now sit once the leaves have landed (opacity,
  // not visibility: a focused note keeps the focus).
  for (const note of turned) note.style.opacity = '0'
  // A note that stays put but changes how it lies among the pages (the section turned to going
  // on, now over the pages; the open one going back, now under them) is shown over them, under
  // the leaves, while they turn, covered only as the leaf over it moves: the last one lifting
  // off it going on, the first one coming down on it going back.
  const held: HTMLElement[] = []
  for (const note of book.querySelectorAll<HTMLElement>('.book-notes [data-section]')) {
    const was = notes.levels.get(note.dataset.section ?? '')
    const now = Number(getComputedStyle(note).zIndex)
    // (No stacking levels without the stylesheet, as in jsdom.)
    if (turned.includes(note) || was === undefined || Number.isNaN(now) || was === now) continue
    if (typeof note.getAnimations === 'function')
      for (const animation of note.getAnimations()) animation.finish()
    const rect = note.getBoundingClientRect()
    const going = direction === 'next'
    const copy = windowed(note, rect, 'right', '')
    copy.win.style.left = `${String(copy.box.left - pagesRect.left)}px`
    copy.win.style.top = `${String(copy.box.top - size.top)}px`
    stay.after(copy.win)
    note.style.opacity = '0'
    held.push(note)
    tracks.push({
      note: copy,
      track: {
        leftAt: () => rect.left,
        span: rect.width,
        side: 'right',
        by: going ? count - 1 : 0,
        covered: going ? 'start' : 'end',
        bands: step * (count - 1),
        edge: going ? oldEdge.right : newEdge.right,
      },
    })
  }
  // The new open page's own edge going on (the old one's going back) shows in the page block
  // while a leaf lies over that page: until the last leaf lifts off it, or from when the first
  // comes down on it.
  const going = direction === 'next'
  const ownEdge = pageEdge(
    going ? notes.from + count : notes.from,
    (going ? oldEdge.right : newEdge.right) + step * (count - 1) - pagesRect.left,
    false,
    step,
    step,
    { side: 'right', near: step * (count - 1) },
  ).strip
  stay.after(ownEdge)
  // The open pages' shadow on the page blocks, a side at a time: where the old pages lay until
  // the leaf over that side moves (the last lifting off it, or the first coming down on it),
  // then where the new ones lie. (The pages' own stays off meanwhile.)
  const sides = ['left', 'right'] as const
  const shadows = sides.flatMap((side) =>
    [true, false].map((old) => {
      const shadow = div('book-pages-shadow')
      shadow.dataset.side = side
      if (pages) {
        shadow.style.cssText = `left:${String(pagesRect.left - size.left)}px;top:${String(pagesRect.top - size.top)}px;width:${String(pagesRect.width)}px;height:${String(pagesRect.height)}px;box-shadow:${getComputedStyle(pages).boxShadow};opacity:${old ? '1' : '0'};transform:translateX(${String(old ? -notes.slide : 0)}px)`
        pages.before(shadow)
      }
      return { shadow, side, old }
    }),
  )
  if (pages) pages.style.boxShadow = 'none'
  const release = () => {
    for (const note of [...turned, ...held]) note.style.opacity = ''
    for (const { shadow } of shadows) shadow.remove()
    pages?.style.removeProperty('box-shadow')
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
      for (const { face, offset, bleed } of lastLeaf.backs)
        paint(face, picture, offset, size, painted, bleed)
      painted.forEach(restoreScrolls)
    },
    BACK_PAINT_MS + (count - 1) * STAGGER_MS,
  )

  // jsdom has no Web Animations; there the leaves just wait for the timer.
  if (typeof stage.animate === 'function') {
    // Over the spine the leaves change places: one still to turn lies under the one turning
    // before it; once over, it lies on the ones turned before it.
    // (The spine strip stands upright half way.)
    const crossing = 0.5
    leaves.forEach((leaf, at) => {
      const timing: KeyframeAnimationOptions = {
        duration: TURN_MS,
        delay: at * STAGGER_MS,
        fill: 'both',
      }
      leaf.strips.forEach((element, index) => {
        const { turn, inner, outer } = keyframesOf(index, sign)
        animations.push(element.animate(turn, timing))
        for (const face of leaf.shades.slice(index * 2, index * 2 + 2))
          animations.push(face.inner.animate(inner, timing), face.outer.animate(outer, timing))
        if (index === STRIPS - 1)
          for (const fold of leaf.folds) animations.push(fold.animate(outer, timing))
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
    })
    // Each leaf shifts from where the old pages lay to where the new ones lie while it is in
    // the air.
    leaves.forEach((leaf, at) => {
      animations.push(
        leaf.wrap.animate(
          Array.from({ length: SAMPLES + 1 }, (_, sample) => ({
            offset: sample / SAMPLES,
            transform: `translateX(${String(-notes.slide * (1 - shiftOf(sample / SAMPLES)))}px)`,
          })),
          { duration: TURN_MS, delay: at * STAGGER_MS, fill: 'both' },
        ),
      )
    })
    const reach = (by: number, ms: number) => reachOf(widths, (ms - by * STAGGER_MS) / TURN_MS)
    const leafAt: LeafAt = {
      total,
      widths,
      reach,
      edge: (by, ms) =>
        pagesAt +
        notes.slide * shifted(by, ms) +
        spine +
        (direction === 'next' ? 1 : -1) * reach(by, ms),
    }
    // The page's own edge goes as the leaf over it lifts off, or comes as it comes down.
    const flat = widths.reduce((sum, strip) => sum + strip, 0)
    const frames = Math.ceil(total / 8)
    const ownTimes = Array.from({ length: frames + 1 }, (_, frame) => (total * frame) / frames)
    /** How far over (0–1) the page block on `side` has gone from the old pages to the new:
     * as the last leaf's free edge draws back off it, or as the first one's comes down on it. */
    const switched = (side: 'left' | 'right', ms: number) => {
      const lifting = (side === 'right') === going
      const away = lifting ? flat - reach(count - 1, ms) : flat + reach(0, ms)
      const near = Math.min(away / SHADE_FADE, 1)
      return Math.round((lifting ? near : 1 - near) * 1000) / 1000
    }
    // (The new page's own edge going on is on the right; the old one's going back, too.)
    animations.push(
      animateChanges(
        ownEdge,
        ownTimes,
        ownTimes.map((ms) => ({
          opacity: going ? 1 - switched('right', ms) : switched('right', ms),
        })),
      ),
      ...shadows.map(({ shadow, side, old }) =>
        animateChanges(
          shadow,
          ownTimes,
          ownTimes.map((ms) => ({ opacity: old ? 1 - switched(side, ms) : switched(side, ms) })),
        ),
      ),
    )
    for (const { note, track } of tracks) animations.push(...followLeaf(note, track, leafAt))
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
