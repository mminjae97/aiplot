import { useLayoutEffect, useRef, useState } from 'react'
import { strings } from '../strings'
import type { Work } from '../types'
import { BookItem, spineOf } from './BookItem'

const GAP = 3
const NEW_BOOK_WIDTH = 58
// Frame post plus the board's inner margin on each side.
const SHELF_PADDING = 44
// One board with its books: top margin, tallest book plus lift, board.
const SHELF_HEIGHT = 312

type Slot = ({ kind: 'work'; work: Work } | { kind: 'new' }) & {
  // Which side of the spine its info slip opens on, away from the bookcase edge.
  slip: 'left' | 'right'
}

/** Packs spines left to right, newest first, onto as many boards as the width needs, and
 * adds empty boards until the bookcase fills the visible height. */
export function packShelves(works: Work[], width: number, height: number): Slot[][] {
  const usable = Math.max(width - SHELF_PADDING * 2, NEW_BOOK_WIDTH)
  const items = [
    ...works.map((work) => ({ kind: 'work' as const, work })),
    { kind: 'new' as const },
  ]
  const shelves: Slot[][] = [[]]
  let used = 0
  for (const item of items) {
    const w = (item.kind === 'work' ? spineOf(item.work.id).width : NEW_BOOK_WIDTH) + GAP
    if (used + w > usable && (shelves.at(-1)?.length ?? 0) > 0) {
      shelves.push([])
      used = 0
    }
    shelves.at(-1)?.push({ ...item, slip: used + w / 2 > usable / 2 ? 'left' : 'right' })
    used += w
  }
  const fill = Math.max(1, Math.floor((height - 24) / SHELF_HEIGHT))
  while (shelves.length < fill) shelves.push([])
  return shelves
}

type Props = {
  works: Work[]
  highlight: string | null
  onOpen: (work: Work) => void
  onNew: () => void
}

export function BookShelf({ works, highlight, onOpen, onNew }: Props) {
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
  return (
    <section className="bookcase" ref={ref} aria-label={strings.library.shelfLabel}>
      {shelves.map((shelf, index) => (
        <div className="shelf" key={index}>
          <div className="shelf-books" role="list">
            {shelf.map((slot) =>
              slot.kind === 'work' ? (
                <div role="listitem" key={slot.work.id}>
                  <BookItem
                    work={slot.work}
                    slip={slot.slip}
                    newest={slot.work.id === newest}
                    highlighted={slot.work.id === highlight}
                    onOpen={onOpen}
                  />
                </div>
              ) : (
                <div role="listitem" key="new">
                  <button type="button" className="book-new" onClick={onNew}>
                    <span className="book-new-plus" aria-hidden="true">
                      +
                    </span>
                    <span className="book-title">{strings.library.newBook}</span>
                  </button>
                </div>
              ),
            )}
          </div>
          <div className="shelf-board" aria-hidden="true" />
          {index === 0 && works.length === 0 && (
            <p className="shelf-tag">{strings.library.empty}</p>
          )}
        </div>
      ))}
    </section>
  )
}
