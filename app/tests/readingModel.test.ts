import { afterEach, expect, test, vi } from 'vitest'
import {
  atEnd,
  continueAt,
  DEFAULT_TYPE,
  FONT_SIZES,
  isFinished,
  LINE_HEIGHTS,
  listed,
  neighbours,
  readingLines,
  savedOrder,
  savedType,
  scrolledShare,
  step,
} from '../src/components/readingModel'
import type { Chapter, ChapterText } from '../src/types'

function chapter(number: number, versions: (number | null)[], read = false): Chapter {
  return {
    id: `ch_${String(number)}`,
    plan_id: 'pl_1',
    episode_id: 'c_ep1',
    number,
    target_chars: 5500,
    read,
    position: 0,
    chars: 0,
    beats: versions.map((version, at) => ({
      id: `b_${String(number)}_${String(at)}`,
      order: at + 1,
      scene: 1,
      source_stage: '발단',
      summary: '',
      techniques: [],
      pov: '',
      mode: '장면화',
      focus: '감정',
      density: '자세히',
      tension: 3,
      target_chars: 800,
      version,
      chars: null,
    })),
  }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

test('only a chapter with text in every beat is finished', () => {
  expect(isFinished(chapter(1, [1, 2]))).toBe(true)
  expect(isFinished(chapter(1, [1, null]))).toBe(false)
  expect(isFinished(chapter(1, []))).toBe(false)
})

test('listed newest or oldest first; 이어 읽기 at the first finished unread chapter', () => {
  const all = [chapter(2, [1]), chapter(1, [1], true), chapter(3, [null]), chapter(4, [1])]
  expect(listed(all, 'newest').map((c) => c.number)).toEqual([4, 3, 2, 1])
  expect(listed(all, 'oldest').map((c) => c.number)).toEqual([1, 2, 3, 4])
  expect(continueAt(all)?.number).toBe(2)
  expect(continueAt([chapter(1, [1], true), chapter(2, [null])])).toBeNull()
})

test('neighbours skip chapters not finished', () => {
  const all = [chapter(1, [1]), chapter(2, [null]), chapter(3, [1])]
  const around = neighbours(all, 'ch_3')
  expect([around.prev?.number, around.next]).toEqual([1, null])
  expect(neighbours(all, 'ch_2')).toEqual({ prev: null, next: null })
})

test('the reading text is the beats in order, a line per paragraph', () => {
  const text: ChapterText = {
    id: 'ch_1',
    number: 1,
    beats: [
      {
        id: 'b_1',
        order: 1,
        version: 1,
        chars: 1,
        origin: 'generated',
        checked: true,
        text: '가\n\n나',
        sentences: [],
      },
      {
        id: 'b_2',
        order: 2,
        version: null,
        chars: null,
        origin: null,
        checked: null,
        text: null,
        sentences: null,
      },
      {
        id: 'b_3',
        order: 3,
        version: 1,
        chars: 1,
        origin: 'edited',
        checked: true,
        text: '다',
        sentences: [],
      },
    ],
  }
  expect(readingLines(text)).toEqual(['가', '', '나', '', '다'])
})

test('the share scrolled past, and the end', () => {
  expect(scrolledShare(0, 1000, 200)).toBe(0)
  expect(scrolledShare(400, 1000, 200)).toBe(0.5)
  expect(scrolledShare(900, 1000, 200)).toBe(1)
  expect(scrolledShare(0, 100, 200)).toBe(1)
  expect(atEnd(797, 1000, 200)).toBe(true)
  expect(atEnd(790, 1000, 200)).toBe(false)
})

test('the type steps within its range; anything stored but known falls back', () => {
  expect(step(FONT_SIZES, 17, 1)).toBe(18)
  expect(step(FONT_SIZES, 15, -1)).toBe(15)
  expect(step(LINE_HEIGHTS, 2.1, 1)).toBe(2.1)
  expect(savedType()).toEqual(DEFAULT_TYPE)
  localStorage.setItem('aiplot.reader.type', JSON.stringify({ size: 19, line: 9 }))
  expect(savedType()).toEqual({ size: 19, line: DEFAULT_TYPE.line })
  localStorage.setItem('aiplot.reader.type', '{')
  expect(savedType()).toEqual(DEFAULT_TYPE)
  expect(savedOrder()).toBe('newest')
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(savedOrder()).toBe('newest')
  expect(savedType()).toEqual(DEFAULT_TYPE)
})
