// The S3-1 writing page's state in plain functions (§10, §16): which job writes what, how a
// chapter stands, a beat's text cut at its warned sentences, and the text a job streams.
import { strings } from '../strings'
import type { BeatText, Chapter, EpisodeCard, Job, SentenceSpan, Warning } from '../types'
import { isJobActive } from './directionEpisodes'

/** The job key of a chapter's writing job (§16, the server's writing.start_chapter). */
export const chapterJobKey = (chapterId: string) => `chapter:${chapterId}`

/** The job key of a beat's job writing it again (§16, writing.start_beat). */
export const beatJobKey = (beatId: string) => `beat:${beatId}`

/** The jobs that write into the chapter: its own and those writing one of its beats again. */
export function jobsOf(chapter: Chapter, jobs: readonly Job[]): Job[] {
  const keys = new Set([chapterJobKey(chapter.id), ...chapter.beats.map((b) => beatJobKey(b.id))])
  return jobs.filter((job) => job.key !== null && keys.has(job.key))
}

/** The job writing the chapter now: a running (or paused) one before a queued one. */
export function activeJob(chapter: Chapter, jobs: readonly Job[]): Job | null {
  const active = jobsOf(chapter, jobs).filter(isJobActive)
  return active.find((job) => job.status !== 'queued') ?? active[0] ?? null
}

/** The chapter's beats a `recheck` job checks now or will (§16: recheck:{beatId}:{version},
 * after a save or a restore). */
export function recheckedBeats(chapter: Chapter, jobs: readonly Job[]): ReadonlySet<string> {
  const ids = new Set(chapter.beats.map((beat) => beat.id))
  const found = new Set<string>()
  for (const job of jobs) {
    const beatId = recheckBeatOf(job)
    if (beatId !== null && ids.has(beatId) && isJobActive(job)) found.add(beatId)
  }
  return found
}

/** The most a beat's text may hold (§16 PUT /beats/{beatId}/text). */
export const MAX_BEAT_CHARS = 20000

/** The beat a `recheck` job checks (§16 recheck:{beatId}:{version}), null for other jobs. */
export function recheckBeatOf(job: Job): string | null {
  return /^recheck:([^:]+):/.exec(job.key ?? '')?.[1] ?? null
}

/** The version a `recheck` job checks, null for other jobs. */
export function recheckVersionOf(job: Job): number | null {
  const version = /^recheck:[^:]+:(\d+)$/.exec(job.key ?? '')?.[1]
  return version === undefined ? null : Number(version)
}

/** The newest failed recheck job (not closed) that is still owed: the version it failed on is
 * its beat's current one, unchecked. A later save, rewrite or a check stored before the
 * summaries failed settles it. Only the newest job of each key counts: a retry (the same text
 * saved again) running or failed in its turn stands for the attempts before it. `jobs` newest
 * first; `beats` = the chapter's text, so other chapters' jobs drop out. */
export function owedRecheck(
  jobs: readonly Job[],
  beats: readonly BeatText[] | undefined,
  closed: ReadonlySet<string>,
): Job | null {
  const current = new Map((beats ?? []).map((beat) => [beat.id, beat]))
  const seen = new Set<string>()
  return (
    jobs.find((job) => {
      if (job.key === null || recheckBeatOf(job) === null || seen.has(job.key)) return false
      seen.add(job.key)
      if (job.status !== 'failed' || closed.has(job.jobId)) return false
      const beat = current.get(recheckBeatOf(job) ?? '')
      return beat !== undefined && beat.version === recheckVersionOf(job) && beat.checked === false
    }) ?? null
  )
}

/** Characters incl. spaces, as the server counts them (§6, §16): line breaks not counted. */
export function countChars(text: string): number {
  return Array.from(text.replace(/\r|\n/g, '')).length
}

/** What a writing job ended with (§16: {chars, warnings, elapsedSec}). */
export type WritingResult = { chars: number; warnings: number; elapsedSec: number }

export function writingResult(data: unknown): WritingResult | null {
  if (typeof data !== 'object' || data === null || !('result' in data)) return null
  const result = data.result
  if (typeof result !== 'object' || result === null) return null
  const { chars, warnings, elapsedSec } = result as Record<string, unknown>
  return typeof chars === 'number' && typeof warnings === 'number' && typeof elapsedSec === 'number'
    ? { chars, warnings, elapsedSec }
    : null
}

/** The newest job that wrote into the chapter, whatever came of it. */
export function latestJobOf(chapter: Chapter, jobs: readonly Job[]): Job | null {
  return jobsOf(chapter, jobs)[0] ?? null
}

export type ChapterStatus = 'done' | 'writing' | 'queued' | 'partly' | 'waiting'

/** A chapter in the list (§10: done/generating/waiting; started ones say how far). */
export function chapterStatus(chapter: Chapter, job: Job | null): ChapterStatus {
  if (job) return job.status === 'queued' ? 'queued' : 'writing'
  const written = chapter.beats.filter((beat) => beat.version !== null).length
  if (written === chapter.beats.length) return 'done'
  return written > 0 ? 'partly' : 'waiting'
}

export function statusText(chapter: Chapter, status: ChapterStatus): string {
  const written = chapter.beats.filter((beat) => beat.version !== null).length
  switch (status) {
    case 'done':
      return strings.writing.rowDone
    case 'writing':
      return strings.writing.rowWriting
    case 'queued':
      return strings.writing.rowQueued
    case 'partly':
      return strings.writing.rowPartly(written, chapter.beats.length)
    case 'waiting':
      return strings.writing.rowWaiting
  }
}

export type ChapterGroup = { episode: EpisodeCard | null; chapters: Chapter[] }

/** Chapters in order under their episode (consecutive chapters of one episode share it). */
export function chapterGroups(
  chapters: readonly Chapter[],
  episodes: readonly EpisodeCard[],
): ChapterGroup[] {
  const known = new Map(episodes.map((card) => [card.id, card]))
  const groups: (ChapterGroup & { id: string })[] = []
  for (const chapter of chapters) {
    const last = groups.at(-1)
    if (last?.id === chapter.episode_id) last.chapters.push(chapter)
    else {
      groups.push({
        id: chapter.episode_id,
        episode: known.get(chapter.episode_id) ?? null,
        chapters: [chapter],
      })
    }
  }
  return groups.map(({ episode, chapters: items }) => ({ episode, chapters: items }))
}

/** A piece of a beat's text: plain, or one sentence (1-based) with its open warnings. */
export type Segment = { text: string; sentence: number | null; warnings: Warning[] }

/** The text cut at the sentences open warnings are about, so those can be underlined. Spans
 * count Unicode code points, as the server does (§15). */
export function segments(
  text: string,
  spans: readonly SentenceSpan[] | null,
  warnings: readonly Warning[],
): Segment[] {
  const bySentence = new Map<number, Warning[]>()
  for (const warning of warnings) {
    if (warning.status !== 'open' || warning.sentence === null) continue
    bySentence.set(warning.sentence, [...(bySentence.get(warning.sentence) ?? []), warning])
  }
  if (!spans || bySentence.size === 0) return [{ text, sentence: null, warnings: [] }]
  const points = Array.from(text)
  const out: Segment[] = []
  let at = 0
  spans.forEach((span, index) => {
    const found = bySentence.get(index + 1)
    if (!found || span.start < at || span.end > points.length) return
    if (span.start > at) {
      out.push({ text: points.slice(at, span.start).join(''), sentence: null, warnings: [] })
    }
    out.push({
      text: points.slice(span.start, span.end).join(''),
      sentence: index + 1,
      warnings: found,
    })
    at = span.end
  })
  if (at < points.length)
    out.push({ text: points.slice(at).join(''), sentence: null, warnings: [] })
  return out
}

/** The text of a sentence (1-based), if the spans have it. */
export function sentenceText(
  text: string | null,
  spans: readonly SentenceSpan[] | null,
  sentence: number | null,
): string | null {
  if (text === null || spans === null || sentence === null) return null
  const span = spans[sentence - 1]
  return span ? Array.from(text).slice(span.start, span.end).join('') : null
}

/** What a writing job has streamed (§16): each beat's text as it arrives since its last
 * beat_start, and the version beat_done stored it as (null while it is still coming). */
export type Streamed = {
  beats: Record<string, { text: string; version: number | null }>
  /** The beat being written now. */
  current: string | null
  /** Beats stored whose check has not ended yet (beat_done, then beat_checked). */
  checking: readonly string[]
}

export const NOTHING_STREAMED: Streamed = { beats: {}, current: null, checking: [] }

/** The state after one event of the job's stream. */
export function streamed(state: Streamed, type: string, data: unknown): Streamed {
  const beatId =
    typeof data === 'object' && data !== null && 'beatId' in data && typeof data.beatId === 'string'
      ? data.beatId
      : null
  switch (type) {
    case 'beat_start':
      if (beatId === null) return state
      return {
        ...state,
        current: beatId,
        beats: { ...state.beats, [beatId]: { text: '', version: null } },
      }
    case 'sentence': {
      const before = beatId === null ? undefined : state.beats[beatId]
      if (beatId === null || !before || typeof data !== 'object' || data === null) return state
      const text = 'text' in data && typeof data.text === 'string' ? data.text : ''
      return {
        ...state,
        beats: { ...state.beats, [beatId]: { ...before, text: before.text + text } },
      }
    }
    case 'beat_done': {
      const before = beatId === null ? undefined : state.beats[beatId]
      const version =
        typeof data === 'object' &&
        data !== null &&
        'version' in data &&
        typeof data.version === 'number'
          ? data.version
          : null
      if (beatId === null || !before) return state
      return {
        ...state,
        current: state.current === beatId ? null : state.current,
        beats: { ...state.beats, [beatId]: { ...before, version } },
        checking: [...state.checking.filter((id) => id !== beatId), beatId],
      }
    }
    case 'beat_checked':
      if (beatId === null) return state
      return { ...state, checking: state.checking.filter((id) => id !== beatId) }
    case 'done':
    case 'error':
    case 'cancelled':
      // A beat stopped before it was stored was never written (§16: cancel stops at once).
      return {
        current: null,
        checking: [],
        beats: Object.fromEntries(
          Object.entries(state.beats).filter(([, beat]) => beat.version !== null),
        ),
      }
    default:
      return state
  }
}

/** The streamed text to show for a beat instead of its stored one: until the stored text is
 * the version the job stored (the stored text may differ from what streamed, §16). */
export function liveText(
  state: Streamed,
  beatId: string,
  storedVersion: number | null,
): string | null {
  const beat = state.beats[beatId]
  if (!beat) return null
  if (beat.version === null) return beat.text
  return storedVersion !== null && storedVersion >= beat.version ? null : beat.text
}
