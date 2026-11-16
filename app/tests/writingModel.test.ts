import { expect, test } from 'vitest'
import {
  activeJob,
  chapterGroups,
  chapterStatus,
  liveText,
  NOTHING_STREAMED,
  segments,
  sentenceText,
  streamed,
  type Streamed,
} from '../src/components/writingModel'
import type { Chapter, EpisodeCard, Job, Warning } from '../src/types'

function chapter(id: string, episode: string, versions: (number | null)[]): Chapter {
  return {
    id,
    plan_id: 'pl_1',
    episode_id: episode,
    number: 1,
    target_chars: 5500,
    read: false,
    chars: 0,
    beats: versions.map((version, at) => ({
      id: `${id}_b${String(at + 1)}`,
      order: at + 1,
      scene: 1,
      source_stage: '발단',
      summary: '요약',
      techniques: [],
      pov: '테오 1인칭',
      mode: '장면화',
      focus: '감정',
      density: '담백',
      tension: 3,
      target_chars: 800,
      version,
      chars: version === null ? null : 700,
    })),
  }
}

function job(key: string, status: Job['status'], jobId = 'job_1'): Job {
  return {
    jobId,
    kind: key.split(':')[0] ?? 'chapter',
    key,
    workId: 'w_1',
    status,
    createdAt: '2026-11-17T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    lastEventId: 0,
    error: null,
  }
}

function warning(sentence: number | null, status: Warning['status'] = 'open'): Warning {
  return {
    id: `wr_${String(sentence)}_${status}`,
    beat_id: 'b_1',
    version: 1,
    kind: 'character',
    sentence,
    card_id: null,
    status,
    reason: '이유',
    ignore_reason: null,
  }
}

test('a chapter is written by its own job or one writing one of its beats again', () => {
  const ch = chapter('ch_1', 'c_ep1', [1, null])
  const other = job('chapter:ch_2', 'running', 'job_0')
  expect(activeJob(ch, [other])).toBeNull()
  const queued = job('chapter:ch_1', 'queued', 'job_1')
  const beat = job('beat:ch_1_b1', 'running', 'job_2')
  // Running before queued, whichever is newer.
  expect(activeJob(ch, [queued, beat])?.jobId).toBe('job_2')
  expect(activeJob(ch, [queued, other])?.jobId).toBe('job_1')
  expect(activeJob(ch, [job('chapter:ch_1', 'done')])).toBeNull()
})

test('a chapter is done, under way, partly written or waiting', () => {
  expect(chapterStatus(chapter('ch', 'e', [1, 2]), null)).toBe('done')
  expect(chapterStatus(chapter('ch', 'e', [1, null]), null)).toBe('partly')
  expect(chapterStatus(chapter('ch', 'e', [null, null]), null)).toBe('waiting')
  expect(chapterStatus(chapter('ch', 'e', [1, 2]), job('beat:x', 'running'))).toBe('writing')
  expect(chapterStatus(chapter('ch', 'e', [null]), job('chapter:ch', 'queued'))).toBe('queued')
})

test('chapters group under their episode in order', () => {
  const episode = { id: 'c_ep1', name: '귀환' } as EpisodeCard
  const groups = chapterGroups(
    [chapter('ch_1', 'c_ep1', []), chapter('ch_2', 'c_ep1', []), chapter('ch_3', 'c_ep9', [])],
    [episode],
  )
  expect(groups.map((g) => [g.episode?.name ?? null, g.chapters.map((c) => c.id)])).toEqual([
    ['귀환', ['ch_1', 'ch_2']],
    [null, ['ch_3']],
  ])
})

test('a text is cut at the sentences open warnings are about, counting code points', () => {
  const text = '😀 웃었다. 그가 말했다.\n둘째 줄'
  // As the server splits it (§15): 😀 is one code point, two UTF-16 units.
  const spans = [
    { start: 0, end: 6 },
    { start: 7, end: 14 },
    { start: 15, end: 19 },
  ]
  expect(sentenceText(text, spans, 2)).toBe('그가 말했다.')
  const cut = segments(text, spans, [warning(2), warning(3, 'ignored'), warning(null)])
  expect(cut.map((piece) => [piece.text, piece.sentence])).toEqual([
    ['😀 웃었다. ', null],
    ['그가 말했다.', 2],
    ['\n둘째 줄', null],
  ])
  expect(cut.map((piece) => piece.text).join('')).toBe(text)
  expect(segments(text, null, [warning(2)])).toEqual([{ text, sentence: null, warnings: [] }])
})

test('streamed text builds per beat, starts over on beat_start and ends at the stored version', () => {
  const events: [string, unknown][] = [
    ['beat_start', { beatId: 'b_1' }],
    ['sentence', { beatId: 'b_1', text: '첫 문장.' }],
    // A continuation not kept as streamed is shown again from nothing.
    ['beat_start', { beatId: 'b_1' }],
    ['sentence', { beatId: 'b_1', text: '다시.' }],
    ['sentence', { beatId: 'b_1', text: ' 이어서.' }],
    ['beat_done', { beatId: 'b_1', chars: 9, version: 2 }],
    ['beat_start', { beatId: 'b_2' }],
    ['sentence', { beatId: 'b_2', text: '반쯤' }],
    ['paused', { reason: 'user' }],
  ]
  const state = events.reduce<Streamed>(
    (old, [type, data]) => streamed(old, type, data),
    NOTHING_STREAMED,
  )
  expect(state.current).toBe('b_2')
  expect(state.paused).toBe(true)
  // The streamed text until the stored one is the version beat_done named.
  expect(liveText(state, 'b_1', 1)).toBe('다시. 이어서.')
  expect(liveText(state, 'b_1', 2)).toBeNull()
  expect(liveText(state, 'b_2', null)).toBe('반쯤')
  // Stopped: the beat never stored is gone; the stored one stays until the text is read.
  const stopped = streamed(state, 'cancelled', {})
  expect(liveText(stopped, 'b_2', null)).toBeNull()
  expect(liveText(stopped, 'b_1', 1)).toBe('다시. 이어서.')
  expect(stopped.paused).toBe(false)
})
