import type { MouseEvent } from 'react'
import { strings } from '../strings'
import type { Work } from '../types'
import { BookFront, bookStyle } from './BookFront'
import { colorOf } from './bookColor'

// Every book is the same size, cover facing out: the front is exactly portrait 1:1.5 (an
// uploaded illustration fits it uncropped) and the spine shows beside it, outside that ratio.
export const COVER_WIDTH = 200
export const COVER_HEIGHT = 300
export const SPINE_WIDTH = 6
export const BOOK_WIDTH = SPINE_WIDTH + COVER_WIDTH

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export type MenuPoint = { x: number; y: number }

/** The cover button's element id, for giving focus back after a menu or dialog. */
export const bookButtonId = (workId: string) => `book-${workId}`

type Props = {
  work: Work
  // Cover illustration (1:1.5); it replaces all cover text.
  cover?: string | null
  newest: boolean
  highlighted: boolean
  onOpen: (work: Work) => void
  onMenu?: (work: Work, at: MenuPoint) => void
}

function menuPoint(event: MouseEvent<HTMLElement>): MenuPoint {
  // The context-menu key and Shift+F10 report no pointer position: open beside the cover.
  if (event.clientX === 0 && event.clientY === 0) {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 3 }
  }
  return { x: event.clientX, y: event.clientY }
}

export function BookItem({ work, cover, newest, highlighted, onOpen, onMenu }: Props) {
  const stage = strings.stage[work.stage]
  const aboutId = `about-${work.id}`
  return (
    <div
      className="book"
      style={bookStyle(colorOf(work))}
      data-highlighted={highlighted || undefined}
    >
      {/* Under the turned book: its shadow on the back panel and where it stands. */}
      <span className="book-shadow" aria-hidden="true" />
      <button
        type="button"
        id={bookButtonId(work.id)}
        className="book-cover"
        aria-label={work.title}
        aria-describedby={aboutId}
        onClick={() => {
          onOpen(work)
        }}
        onContextMenu={(event) => {
          if (!onMenu) return
          event.preventDefault()
          onMenu(work, menuPoint(event))
        }}
      >
        {newest && <span className="book-ribbon" aria-hidden="true" />}
        <BookFront title={work.title} stage={stage} image={cover ?? null} />
      </button>
      <span className="book-stand" aria-hidden="true" />
      {/* No slip on the shelf (it covered the neighbours); screen readers still hear these. */}
      <span className="visually-hidden" id={aboutId}>
        {strings.library.stageOf(stage)},{' '}
        {strings.library.modified(dateFormat.format(new Date(work.updated_at)))}
      </span>
    </div>
  )
}
