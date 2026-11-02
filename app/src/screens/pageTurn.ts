// Leaves of soft paper turning over the spine (§12 S1 book). A leaf is cut into narrow strips
// hinged one on the next. The whole leaf lifts and lands together, the part further out lagging
// a little behind in between, so the paper curls without its free edge being dragged flat
// across the page or spreading out late as it lands. Turning past several
// sections turns one leaf per section, each a moment after the one before, as a reader's thumb
// lets pages go. The first leaf's front is a picture of the page being turned, the last one's
// back the page it lands on (the leaves between are blank paper); the half no leaf has covered
// yet keeps showing the old page. The new page lies where it belongs from the start. Each leaf
// is the sheet between two sections' pages, which lie 3px apart (the page blocks): it starts
// where its front page lies and shifts the 3px to where its back page lies while in the air,
// carrying its own section's post-it. Everything that
// moves is a transform or an opacity, so the compositor alone draws the turn. Pictures are inert
// copies of the DOM.

export type TurnDirection = 'next' | 'prev'

/** Strips per leaf: more bend more smoothly, each costs two copies of the spread. */
const STRIPS = 16
/** How far (deg) the free edge lags behind the spine half way over (0 = a stiff board). */
const CURL = 30
/** How far out from the spine (share of the leaf) a page darkens into the gutter, and how dark
 * it gets there (contents.css .page-left, .page-right). */
const GUTTER = 0.18
const GUTTER_DARK = 0.14
/** Samples per strip for its keyframes. */
const SAMPLES = 60
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
  const node = spread.cloneNode(true) as HTMLElement
  // Its own paper, wherever the picture goes in the book (the open section's tone changes).
  const style = getComputedStyle(spread)
  for (const name of ['--paper', '--paper-edge'])
    node.style.setProperty(name, style.getPropertyValue(name))
  return { node, scrolls }
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
  // (Keeping the picture's own paper tone, set on it inline.)
  copy.style.cssText += `;position:absolute;top:0;left:${String(bleed - offset)}px;width:${String(size.width)}px;height:${String(size.height)}px;margin:0;translate:none;transition:none`
  box.prepend(copy)
  // (No paper of the box's own under it: book.css .leaf-face[data-picture].)
  box.dataset.picture = 'true'
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

/** How far over (0–1) a leaf has shifted at `time` (0–1 of its turn): with the spine's height,
 * so it shifts while in the air and never while it lies on a page. */
const shiftOf = (time: number) => 0.5 - 0.5 * Math.cos((angleOf(0, time) * Math.PI) / 180)

/** Section `section`'s paper and page edge (base.css: the sections' pages alternate two tones). */
const toneOf = (section: number) => (section % 2 === 1 ? 'b' : 'a')

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

/** A face's shading: two gradients, one darkest at the strip's inner edge and one at its
 * outer edge, their opacities set from the paper's angle there. */
type Shades = { inner: HTMLElement; outer: HTMLElement }

type Leaf = {
  /** Holds the leaf's own 3D view; its z-index puts it over or under the other leaves. */
  wrap: HTMLElement
  strips: HTMLElement[]
  shades: Shades[]
  backs: { face: HTMLElement; offset: number; bleed: number }[]
}

/** How a note, or its copy on a leaf, is covered while the leaves turn by a leaf over it (lifting
 * off it, or coming down on it), from the open pages' side (on the right: going on, leaves
 * lift off it; going back, they come down on it). */
type Track = {
  /** Its left edge on screen `ms` into the turn, and its width. */
  leftAt: (ms: number) => number
  span: number
  /** The leaf over it, and whether it lies under that leaf as the turn starts (the leaf lifts
   * off it) or as it ends (the leaf comes down on it). */
  by: number
  covered: 'start' | 'end'
}

/** The leaves as a turn plays them: its length, and where on screen leaf `by`'s free edge is
 * `ms` into it. */
type LeafAt = { total: number; edge: (by: number, ms: number) => number }

/** Animates `target` through `steps`, its look at each of `times` (ms into the turn), running
 * only while the look changes: before that it holds the first, after that the last. */
function animateChanges(target: HTMLElement, times: number[], steps: Keyframe[]): Animation {
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
  return target.animate(changing, { delay: from, duration, fill: 'both' })
}

/** Animates a windowed note's cut along `track`; returns the animations. */
function followLeaf({ win, copy, base }: Windowed, track: Track, leaf: LeafAt): Animation[] {
  const frames = Math.ceil(leaf.total / 8)
  const times = Array.from({ length: frames + 1 }, (_, frame) => (leaf.total * frame) / frames)
  // Covered from the open pages' side up to the leaf's free edge: the window slides over that
  // far (into the room on its other side), the note back.
  const shifts = times.map((ms) =>
    Math.max(leaf.edge(track.by, ms) - track.leftAt(ms) + NOTE_SHADOW, 0),
  )
  return [
    animateChanges(
      win,
      times,
      shifts.map((shift) => ({ transform: `${base} translateX(${String(shift)}px)` })),
    ),
    animateChanges(
      copy,
      times,
      shifts.map((shift) => ({ transform: `translateX(${String(-shift)}px)` })),
    ),
  ]
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
  // How far (px) apart two sections' pages lie: the page blocks' layers (book.css .book-edge).
  const unit = notes.slide / count

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
    // The sections whose pages its faces are (the first leaf's front and the last one's back
    // are pictures of them): going on, the right page of one and the left of the next; going
    // back, the left page of one and the right of the one before.
    const [frontSection, backSection] =
      direction === 'next'
        ? [notes.from + at, notes.from + at + 1]
        : [notes.from - at, notes.from - at - 1]
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
      // A blank face darkens into the gutter as the pages do (a picture has its own gutter): a
      // leaf turned a moment earlier, its spine not yet where the next one's is, shows by it as
      // the gutter rather than a light line.
      const gutter = (face: HTMLElement, innerLeft: boolean) => {
        const reach = GUTTER * (direction === 'next' ? width - spine : spine)
        const near = Math.abs(from - spine)
        if (near >= reach) return
        const dark = (distance: number) =>
          Math.round(GUTTER_DARK * Math.max(1 - distance / reach, 0) * 1000) / 1000
        const shade = div('leaf-gutter')
        shade.style.background = `linear-gradient(${innerLeft ? '90deg' : '270deg'}, rgb(80 55 30 / ${String(dark(near))}), rgb(80 55 30 / ${String(dark(Math.abs(to - spine)))}))`
        face.prepend(shade)
      }
      const front = div(`leaf-face leaf-front${end}`)
      front.style.setProperty('--paper', `var(--page-${toneOf(frontSection)})`)
      const frontShades = shading(front, direction === 'next')
      gutter(front, direction === 'next')
      // Only the first leaf shows the page being turned; the others are the pages between.
      if (at === 0) paint(front, before, Math.min(from, to), size, placed, bleed)
      const back = div(`leaf-face leaf-back${end}`)
      back.style.setProperty('--paper', `var(--page-${toneOf(backSection)})`)
      const backShades = shading(back, direction !== 'next')
      gutter(back, direction !== 'next')
      backs.push({ face: back, offset: 2 * spine - Math.max(from, to), bleed })
      element.append(front, back)
      parent.append(element)
      parent = element
      strips.push(element)
      shades.push(frontShades, backShades)
    }
    stage.append(wrap)
    return { wrap, strips, shades, backs }
  })

  // Each leaf carries its own section's note on its outer strip: the open section's over its
  // paper, the others tucked under it, as on the page.
  const live = notes.sections.map((section) =>
    book.querySelector<HTMLElement>(`.book-notes [data-section='${section}']`),
  )
  // On screen: the old open pages, and leaf `at`'s outer strip's left edge as the turn starts
  // (`at` sections on from them). A front copy sits where its note was; a back copy where, once
  // the strip has turned over the spine (and shifted on one section with it), it lands on its
  // note.
  const pagesAt = pagesRect.left - notes.slide
  const spineAt = pagesAt + spine
  const stripAt = (at: number) =>
    pagesAt + at * unit + (direction === 'next' ? edge(STRIPS - 1) : edge(STRIPS))
  const landing = (at: number, rect: Box) =>
    2 * spineAt + (2 * at + 1) * unit - stripAt(at) - rect.left - rect.width
  /** How far over (0–1) leaf `at` has shifted `ms` into the turn. */
  const shifted = (at: number, ms: number) => shiftOf((ms - at * STAGGER_MS) / TURN_MS)
  /** How far (px) a copy riding on leaf `at` has shifted with it `ms` into the turn: from where
   * its note was (front) or to where its note is (back). */
  const glided = (at: number, ms: number, back: boolean) =>
    unit * (shifted(at, ms) - (back ? 1 : 0))
  const tracks: { note: Windowed; track: Track }[] = []
  /** Leaf `at`'s note copies, the front one (where the note was) and the back one (where it
   * lands), that a leaf over them cuts off (the others its own paper covers, or none): going on,
   * a note riding on its own page under the leaf before it; going back, one landing under the
   * leaf after it. */
  const tracksOf = (at: number, was: DOMRect | undefined, now: DOMRect | undefined) => {
    const out: { back: boolean; track: Track }[] = []
    const add = (back: boolean, rect: DOMRect, by: number) => {
      out.push({
        back,
        track: {
          leftAt: (ms) => rect.left + glided(at, ms, back),
          span: rect.width,
          by,
          covered: back ? 'end' : 'start',
        },
      })
    }
    if (direction === 'next' && was && at > 0) add(false, was, at - 1)
    if (direction === 'prev' && now && at < count - 1) add(true, now, at + 1)
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
      const note = windowed(source, rect, 'right', base)
      // Where the note is on the page, in the outer strip's own frame.
      note.win.style.left = `${String(back ? landing(at, note.box) : note.box.left - stripAt(at))}px`
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
        by: going ? count - 1 : 0,
        covered: going ? 'start' : 'end',
      },
    })
  }
  const release = () => {
    for (const note of [...turned, ...held]) note.style.opacity = ''
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
    // Each leaf shifts on one section, from where its front page lies to where its back page
    // lies, while it is in the air.
    leaves.forEach((leaf, at) => {
      animations.push(
        leaf.wrap.animate(
          Array.from({ length: SAMPLES + 1 }, (_, sample) => ({
            offset: sample / SAMPLES,
            transform: `translateX(${String(-unit * (count - at - shiftOf(sample / SAMPLES)))}px)`,
          })),
          { duration: TURN_MS, delay: at * STAGGER_MS, fill: 'both' },
        ),
      )
    })
    const reach = (by: number, ms: number) => reachOf(widths, (ms - by * STAGGER_MS) / TURN_MS)
    const leafAt: LeafAt = {
      total,
      edge: (by, ms) =>
        spineAt + unit * (by + shifted(by, ms)) + (direction === 'next' ? 1 : -1) * reach(by, ms),
    }
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
