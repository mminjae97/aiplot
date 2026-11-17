import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import type { Chapter } from '../types'
import {
  atEnd,
  FONT_SIZES,
  LINE_HEIGHTS,
  type ReaderType,
  readingLines,
  scrolledShare,
  step,
} from './readingModel'

type Props = {
  chapter: Chapter
  /** Where to open it: the share of its text already scrolled past (0 = its start). */
  startAt: number
  prev: Chapter | null
  next: Chapter | null
  type: ReaderType
  onType: (type: ReaderType) => void
  onOpen: (chapter: Chapter) => void
  /** Where the reader is now (saved a moment after the scrolling stops, and on leaving). */
  onPosition: (share: number) => void
  /** The reader came to the chapter's end. */
  onEnd: () => void
}

// The position is saved once the scrolling has stopped this long.
const SAVE_AFTER_MS = 700

/** S3-3 (§12): one finished chapter, read-only, in the reader's type; ← and → (or the
 * buttons) open the chapters before and after it. Reading to its end marks it read. Opened
 * anew (keyed) for each chapter. */
export function ChapterReader({
  chapter,
  startAt,
  prev,
  next,
  type,
  onType,
  onOpen,
  onPosition,
  onEnd,
}: Props) {
  const text = useQuery({
    queryKey: ['chapter', chapter.id],
    queryFn: () => api.getChapter(chapter.id),
  })
  const box = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  const ended = useRef(false)
  // Marked unread meanwhile (in the list): reading to the end marks it again.
  useEffect(() => {
    if (!chapter.read) ended.current = false
  }, [chapter.read])
  // The scroll the opening itself made (a scroll event follows it): not the reader's.
  const restored = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // The latest callbacks, for the timer and the leaving flush.
  const callbacks = useRef({ onPosition, onEnd })
  useEffect(() => {
    callbacks.current = { onPosition, onEnd }
  })

  const reachEnd = () => {
    if (ended.current) return
    ended.current = true
    callbacks.current.onEnd()
  }

  // Once the text is in: open at the saved place; a chapter that shows whole is read at once.
  useLayoutEffect(() => {
    const element = box.current
    if (placed.current || !text.data || !element) return
    placed.current = true
    const room = element.scrollHeight - element.clientHeight
    element.scrollTop = Math.max(0, room) * startAt
    if (element.scrollTop > 0) restored.current = element.scrollTop
    if (room <= 0) reachEnd()
  })

  // Leaving the chapter saves where it was left.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current !== null) callbacks.current.onPosition(pending.current)
    },
    [],
  )

  const onScroll = () => {
    const element = box.current
    if (!element || !placed.current) return
    const { scrollTop, scrollHeight, clientHeight } = element
    const opening = restored.current === scrollTop
    restored.current = null
    if (opening) return
    pending.current = scrolledShare(scrollTop, scrollHeight, clientHeight)
    if (atEnd(scrollTop, scrollHeight, clientHeight)) reachEnd()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (pending.current === null) return
      callbacks.current.onPosition(pending.current)
      pending.current = null
    }, SAVE_AFTER_MS)
  }

  const name = strings.reading.chapterName(chapter.number)
  return (
    <div className="reader">
      <div className="reader-head">
        <h3 id="reader-title">{name}</h3>
        <div className="reader-type" role="group" aria-label={strings.reading.settings}>
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.smaller}
            title={strings.reading.smaller}
            disabled={type.size === FONT_SIZES[0]}
            onClick={() => {
              onType({ ...type, size: step(FONT_SIZES, type.size, -1) })
            }}
          >
            가-
          </button>
          <span aria-live="polite">{strings.reading.fontSize(type.size)}</span>
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.larger}
            title={strings.reading.larger}
            disabled={type.size === FONT_SIZES[FONT_SIZES.length - 1]}
            onClick={() => {
              onType({ ...type, size: step(FONT_SIZES, type.size, 1) })
            }}
          >
            가+
          </button>
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.tighter}
            title={strings.reading.tighter}
            disabled={type.line === LINE_HEIGHTS[0]}
            onClick={() => {
              onType({ ...type, line: step(LINE_HEIGHTS, type.line, -1) })
            }}
          >
            ≡-
          </button>
          <span aria-live="polite">{strings.reading.lineHeight(type.line)}</span>
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.looser}
            title={strings.reading.looser}
            disabled={type.line === LINE_HEIGHTS[LINE_HEIGHTS.length - 1]}
            onClick={() => {
              onType({ ...type, line: step(LINE_HEIGHTS, type.line, 1) })
            }}
          >
            ≡+
          </button>
        </div>
      </div>
      <div
        ref={box}
        className="reader-text"
        role="document"
        aria-labelledby="reader-title"
        // focusable, so the keyboard scrolls it (PageUp/PageDown too: the book leaves them to it)
        tabIndex={0}
        data-page-keys
        style={{ fontSize: `${String(type.size)}px`, lineHeight: type.line }}
        onScroll={onScroll}
      >
        {text.isError && !text.data && (
          <div className="writing-failure" role="alert">
            <p>{strings.reading.loadFailed}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void text.refetch()
              }}
            >
              {strings.reading.retry}
            </button>
          </div>
        )}
        {text.data &&
          readingLines(text.data).map((line, at) =>
            line.trim() === '' ? (
              <p key={at} className="reader-gap" aria-hidden="true" />
            ) : (
              <p key={at}>{line}</p>
            ),
          )}
        {text.data && <p className="reader-end">{strings.reading.end}</p>}
      </div>
      <nav className="reader-turns" aria-label={strings.reading.keys}>
        {prev ? (
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.prevLabel(prev.number)}
            onClick={() => {
              onOpen(prev)
            }}
          >
            {strings.reading.prev(prev.number)}
          </button>
        ) : (
          <span />
        )}
        <small>{strings.reading.keys}</small>
        {next ? (
          <button
            type="button"
            className="paper-button"
            aria-label={strings.reading.nextLabel(next.number)}
            onClick={() => {
              onOpen(next)
            }}
          >
            {strings.reading.next(next.number)}
          </button>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}
