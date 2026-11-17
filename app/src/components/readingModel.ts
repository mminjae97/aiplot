// S3-2 chapter list and S3-3 reader (§12) in plain functions: which chapters can be read, in
// what order they are listed, where 이어 읽기 opens, and the reader's remembered type.
import type { Chapter, ChapterText } from '../types'

/** A chapter written to its end: every beat has text. Only those are read. */
export const isFinished = (chapter: Chapter) =>
  chapter.beats.length > 0 && chapter.beats.every((beat) => beat.version !== null)

export type ReadingOrder = 'newest' | 'oldest'

/** The list: newest first (the latest chapter on top) or oldest first. */
export function listed(chapters: readonly Chapter[], order: ReadingOrder): Chapter[] {
  const byNumber = [...chapters].sort((a, b) => a.number - b.number)
  return order === 'newest' ? byNumber.reverse() : byNumber
}

/** 이어 읽기: the first finished chapter not read yet, null when every one is. */
export function continueAt(chapters: readonly Chapter[]): Chapter | null {
  return listed(chapters, 'oldest').find((chapter) => isFinished(chapter) && !chapter.read) ?? null
}

/** The finished chapters just before and after one, in story order (the reader's ← and →). */
export function neighbours(
  chapters: readonly Chapter[],
  chapterId: string,
): { prev: Chapter | null; next: Chapter | null } {
  const finished = listed(chapters, 'oldest').filter(isFinished)
  const at = finished.findIndex((chapter) => chapter.id === chapterId)
  if (at < 0) return { prev: null, next: null }
  return { prev: finished[at - 1] ?? null, next: finished[at + 1] ?? null }
}

/** The chapter's text as the reader shows it: its beats in order, a line per paragraph, a
 * blank line between beats (a beat's text ends without one). */
export function readingLines(text: ChapterText): string[] {
  return text.beats
    .flatMap((beat) => (beat.text === null ? [] : [beat.text.split('\n')]))
    .flatMap((lines, at) => (at === 0 ? lines : ['', ...lines]))
}

/** The share of a scrolled box's text scrolled past: 0 at its start, 1 at its end (or when it
 * all shows at once). */
export function scrolledShare(top: number, height: number, view: number): number {
  const room = height - view
  if (room <= 0) return 1
  return Math.min(1, Math.max(0, top / room))
}

/** Within a few pixels of the end: the chapter has been read to it. */
export const atEnd = (top: number, height: number, view: number) => top + view >= height - 4

// The reader's type (§12 S3-3: font size, line height), remembered in the app; the
// manuscript's 17px and 1.7 (§5) by default.
export const FONT_SIZES = [15, 16, 17, 18, 19, 20, 21, 22] as const
export const LINE_HEIGHTS = [1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1] as const
export type ReaderType = { size: number; line: number }
export const DEFAULT_TYPE: ReaderType = { size: 17, line: 1.7 }

const TYPE_KEY = 'aiplot.reader.type'
const ORDER_KEY = 'aiplot.reader.order'

const oneOf = (value: unknown, list: readonly number[], fallback: number) =>
  typeof value === 'number' && list.includes(value) ? value : fallback

export function savedType(): ReaderType {
  try {
    const raw = localStorage.getItem(TYPE_KEY)
    const found = raw === null ? null : (JSON.parse(raw) as Partial<ReaderType> | null)
    return {
      size: oneOf(found?.size, FONT_SIZES, DEFAULT_TYPE.size),
      line: oneOf(found?.line, LINE_HEIGHTS, DEFAULT_TYPE.line),
    }
  } catch {
    return DEFAULT_TYPE
  }
}

export function saveType(type: ReaderType) {
  try {
    localStorage.setItem(TYPE_KEY, JSON.stringify(type))
  } catch {
    // Not remembered this time; the page still shows it.
  }
}

export function savedOrder(): ReadingOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest'
  } catch {
    return 'newest'
  }
}

export function saveOrder(order: ReadingOrder) {
  try {
    localStorage.setItem(ORDER_KEY, order)
  } catch {
    // Not remembered this time; the list still changes.
  }
}

/** The next value along a list of steps (-1 smaller, +1 larger), kept within it. */
export function step(list: readonly number[], value: number, by: -1 | 1): number {
  const at = list.indexOf(value)
  if (at < 0) return value
  return list[Math.min(list.length - 1, Math.max(0, at + by))] ?? value
}
