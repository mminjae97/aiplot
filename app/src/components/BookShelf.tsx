import { type ComponentProps, type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { useCoverImage } from '../api/covers'
import { strings } from '../strings'
import type { Work } from '../types'
import {
  BOOK_WIDTH,
  BookItem,
  COVER_HEIGHT,
  COVER_WIDTH,
  type MenuPoint,
  SPINE_WIDTH,
} from './BookItem'

// Spacing follows the cover size: half its width between books, half its height of clear
// space above each row.
const GAP = COVER_WIDTH * 0.5
const CLEAR = COVER_HEIGHT * 0.5
const BOARD = 22
// Below the last board.
const BOTTOM = 40
// Frame post plus the board's inner margin on each side.
const SHELF_PADDING = 48
// One board with its covers: top margin, cover plus lift, board.
const SHELF_HEIGHT = CLEAR + COVER_HEIGHT + BOARD

type Slot = ({ kind: 'work'; work: Work } | { kind: 'new' }) & {
  // Which side of the cover its info slip opens on, away from the bookcase edge.
  slip: 'left' | 'right'
}

export function perShelf(width: number): number {
  const usable = Math.max(width - SHELF_PADDING * 2, BOOK_WIDTH)
  return Math.max(1, Math.floor((usable + GAP) / (BOOK_WIDTH + GAP)))
}

/** Stands covers left to right, newest first, as many per board as fit the width; below the
 * last books there is always one empty board (scrolling to it if need be), and more empty
 * boards until the bookcase fills the visible height. */
export function packShelves(works: Work[], width: number, height: number): Slot[][] {
  const columns = perShelf(width)
  const items = [
    ...works.map((work) => ({ kind: 'work' as const, work })),
    { kind: 'new' as const },
  ]
  const shelves: Slot[][] = []
  items.forEach((item, index) => {
    const column = index % columns
    if (column === 0) shelves.push([])
    const slip = columns > 1 && column >= columns / 2 ? 'left' : 'right'
    shelves.at(-1)?.push({ ...item, slip })
  })
  const fill = Math.max(1, Math.floor((height - BOTTOM) / SHELF_HEIGHT))
  shelves.push([])
  while (shelves.length < fill) shelves.push([])
  return shelves
}

type Props = {
  works: Work[]
  highlight: string | null
  onOpen: (work: Work) => void
  onMenu: (work: Work, at: MenuPoint) => void
  onNew: () => void
}

/** A shelf book with its cover illustration fetched (the cloth shows until it arrives). */
function ShelfBook(props: Omit<ComponentProps<typeof BookItem>, 'cover'>) {
  const cover = useCoverImage(props.work.id, props.work.cover_id)
  return <BookItem {...props} cover={cover} />
}

export function BookShelf({ works, highlight, onOpen, onMenu, onNew }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [size, setSize] = useState({ width: 960, height: 640 })

  useLayoutEffect(() => {
    // The scrolling library, not the bookcase: the bookcase grows with its boards.
    const viewport = ref.current?.parentElement
    if (!viewport) return
    const measure = () => {
      setSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => {
      observer.disconnect()
    }
  }, [])

  const shelves = packShelves(works, size.width, size.height)
  const newest = works[0]?.id
  // Every row spans the same centred grid, so a short last row still starts at its left edge.
  const row = {
    '--row-width': `${String(perShelf(size.width) * (BOOK_WIDTH + GAP) - GAP)}px`,
  } as CSSProperties
  const metrics = {
    '--cover-width': `${String(COVER_WIDTH)}px`,
    '--spine-width': `${String(SPINE_WIDTH)}px`,
    '--book-width': `${String(BOOK_WIDTH)}px`,
    '--cover-height': `${String(COVER_HEIGHT)}px`,
    '--cover-gap': `${String(GAP)}px`,
    '--shelf-clear': `${String(CLEAR)}px`,
    '--board': `${String(BOARD)}px`,
    '--bookcase-bottom': `${String(BOTTOM)}px`,
  } as CSSProperties
  return (
    <section className="bookcase" ref={ref} style={metrics} aria-label={strings.library.shelfLabel}>
      {/* One list for every book; boards and rows are only layout. */}
      <div role="list">
        {shelves.map((shelf, index) => (
          <div className="shelf" key={index}>
            <div className="shelf-row" style={row}>
              <div className="shelf-books">
                {shelf.map((slot) =>
                  slot.kind === 'work' ? (
                    <div role="listitem" key={slot.work.id}>
                      <ShelfBook
                        work={slot.work}
                        slip={slot.slip}
                        newest={slot.work.id === newest}
                        highlighted={slot.work.id === highlight}
                        onOpen={onOpen}
                        onMenu={onMenu}
                      />
                    </div>
                  ) : (
                    <div role="listitem" key="new" className="book-slot">
                      <button
                        type="button"
                        className="book-new"
                        aria-describedby={works.length === 0 ? 'shelf-empty-tag' : undefined}
                        onClick={onNew}
                      >
                        <span className="book-new-plus" aria-hidden="true">
                          +
                        </span>
                        <span className="book-new-label">{strings.library.newBook}</span>
                      </button>
                    </div>
                  ),
                )}
              </div>
              {index === 0 && works.length === 0 && (
                // Read with the + book (its description), so the list keeps only books.
                <p className="shelf-tag" id="shelf-empty-tag" aria-hidden="true">
                  {strings.library.empty}
                </p>
              )}
            </div>
            <div className="shelf-board" aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  )
}
