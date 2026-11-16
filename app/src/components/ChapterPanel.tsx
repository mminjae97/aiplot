import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Chapter, Job, Warning } from '../types'
import { ConsistencyWarning } from './ConsistencyWarning'
import { remaining } from './GenerationProgress'
import { ManuscriptEditor } from './ManuscriptEditor'
import { useWritingStream } from './useWritingStream'
import { activeJob, latestJobOf } from './writingModel'

type Props = {
  workId: string
  chapter: Chapter
  episodeName: string | null
  /** All the work's jobs, newest first. */
  jobs: readonly Job[]
  names: ReadonlyMap<string, string>
}

function errorText(code: string | undefined, fallback: string): string {
  return (code === undefined ? undefined : strings.writing.errors[code]) ?? fallback
}

const failureOf = (error: unknown, fallback: string) =>
  error instanceof ApiRequestError ? errorText(error.code, fallback) : fallback

/** The selected chapter (§10 S3-1): its manuscript with the controls that write it, and its
 * warnings beside it. Writing runs as a job on the server, so it carries on while the reader is
 * elsewhere and streams in again on return. */
export function ChapterPanel({ workId, chapter, episodeName, jobs, names }: Props) {
  const queryClient = useQueryClient()
  const [selectedBeat, setSelectedBeat] = useState<string | null>(null)
  const [focused, setFocused] = useState<Warning | null>(null)
  const [pauseAsked, setPauseAsked] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const text = useQuery({
    queryKey: ['chapter', chapter.id],
    queryFn: () => api.getChapter(chapter.id),
  })
  const warnings = useQuery({
    queryKey: ['warnings', chapter.id],
    queryFn: () => api.chapterWarnings(chapter.id),
  })

  const job = activeJob(chapter, jobs)
  const refresh = useCallback(
    (type: string) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter', chapter.id] })
      void queryClient.invalidateQueries({ queryKey: ['warnings', chapter.id] })
      void queryClient.invalidateQueries({ queryKey: ['chapters', workId] })
      if (type !== 'beat_done' && type !== 'beat_checked') {
        void queryClient.invalidateQueries({ queryKey: ['jobs', workId] })
      }
    },
    [chapter.id, queryClient, workId],
  )
  const { streamed, progress } = useWritingStream(job?.jobId ?? null, refresh)

  const started = () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] })
  const generate = useMutation({
    mutationFn: () => api.generateChapter(chapter.id),
    onSuccess: started,
  })
  const regenerate = useMutation({
    mutationFn: (beatId: string) => api.regenerateBeat(beatId),
    onSuccess: started,
  })
  const pause = useMutation({
    mutationFn: (jobId: string) => api.pauseJob(jobId),
    onMutate: (jobId) => {
      setPauseAsked(jobId)
    },
    onSettled: started,
  })
  const resume = useMutation({
    mutationFn: (jobId: string) => api.resumeJob(jobId),
    onMutate: () => {
      setPauseAsked(null)
    },
    onSettled: started,
  })
  const stop = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSettled: () => {
      refresh('cancelled')
    },
  })

  const written = new Set(
    (text.data?.beats ?? []).filter((beat) => beat.version !== null).map((b) => b.id),
  )
  const complete = chapter.beats.every((beat) => beat.version !== null)
  const anyWritten = chapter.beats.some((beat) => beat.version !== null)
  const paused = job !== null && (job.status === 'paused' || streamed.paused)
  const running = job !== null && job.status !== 'queued'
  const canRegenerate =
    job === null && selectedBeat !== null && written.has(selectedBeat) && !regenerate.isPending

  const togglePause = useCallback(() => {
    if (!job || job.status === 'queued') return
    if (paused) resume.mutate(job.jobId)
    else if (pauseAsked !== job.jobId) pause.mutate(job.jobId)
  }, [job, paused, pauseAsked, pause, resume])

  const rewrite = useCallback(
    (beatId: string) => {
      if (job !== null || regenerate.isPending) return
      generate.reset()
      setSelectedBeat(beatId)
      regenerate.mutate(beatId)
    },
    [generate, job, regenerate],
  )

  // Ctrl+. pauses or resumes, Ctrl+Shift+R writes the picked beat again (§12 shortcuts).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.repeat) return
      if (event.key === '.' && !event.shiftKey) {
        event.preventDefault()
        togglePause()
      } else if (event.code === 'KeyR' && event.shiftKey) {
        event.preventDefault()
        if (canRegenerate) rewrite(selectedBeat)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [canRegenerate, rewrite, selectedBeat, togglePause])

  const latest = latestJobOf(chapter, jobs)
  const jobFailure =
    latest?.status === 'failed' && dismissed !== latest.jobId
      ? errorText(latest.error?.code, strings.writing.failed)
      : null
  const actionError =
    generate.error ?? regenerate.error ?? pause.error ?? resume.error ?? stop.error
  const notice = actionError ? failureOf(actionError, strings.writing.failed) : jobFailure

  const status = (() => {
    if (!job) return null
    if (job.status === 'queued') return strings.writing.queued
    if (paused) return strings.writing.paused
    if (pauseAsked === job.jobId) return strings.writing.pausing
    if (job.kind === 'beat') return strings.writing.beatProgress
    if (!progress) return strings.writing.starting
    return strings.writing.progress(Math.min(progress.done + 1, progress.total), progress.total)
  })()
  const eta = progress?.etaSec ?? null
  // The time left of a chapter being written, not while it stops at the next beat.
  const counting = running && !paused && pauseAsked !== job.jobId && job.kind === 'chapter'

  return (
    <>
      <div className="writing-center">
        <header className="writing-head">
          <h3>
            {strings.writing.chapterName(chapter.number)}
            {episodeName && <small>{episodeName}</small>}
          </h3>
          <p className="writing-counter" title={strings.writing.counterLabel}>
            <span className="visually-hidden">{strings.writing.counterLabel} </span>
            {strings.writing.counter(chapter.chars, chapter.target_chars)}
          </p>
        </header>
        <div className="writing-toolbar" role="toolbar" aria-label={strings.writing.controls}>
          {!job && !complete && (
            <button
              type="button"
              className="paper-button"
              data-primary=""
              disabled={generate.isPending}
              onClick={() => {
                regenerate.reset()
                generate.mutate()
              }}
            >
              {anyWritten ? strings.writing.resume : strings.writing.write}
            </button>
          )}
          <button
            type="button"
            className="paper-button"
            disabled={!running || pause.isPending || resume.isPending}
            aria-keyshortcuts="Control+."
            onClick={togglePause}
          >
            {paused ? strings.writing.resumeJob : strings.writing.pause}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={!job || stop.isPending}
            onClick={() => {
              if (job) stop.mutate(job.jobId)
            }}
          >
            {strings.writing.stop}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={!canRegenerate}
            title={selectedBeat === null ? strings.writing.regenerateHint : undefined}
            aria-keyshortcuts="Control+Shift+R"
            onClick={() => {
              if (selectedBeat !== null) rewrite(selectedBeat)
            }}
          >
            {strings.writing.regenerate}
          </button>
        </div>
        {job && (
          <div className="writing-progress" role="status">
            <p>
              {status}
              {counting && eta !== null && ` · ${remaining(eta)}`}
            </p>
            <progress
              max={progress?.total ?? 1}
              value={progress?.done ?? undefined}
              aria-label={strings.generation.progressLabel}
            />
            <small>
              {eta === null && !paused ? `${strings.writing.usual} ` : ''}
              {strings.generation.background}
            </small>
          </div>
        )}
        {notice && (
          <div className="writing-failure" role="alert">
            <p>{notice}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                generate.reset()
                regenerate.reset()
                pause.reset()
                resume.reset()
                stop.reset()
                if (latest) setDismissed(latest.jobId)
              }}
            >
              {strings.writing.dismiss}
            </button>
          </div>
        )}
        {text.isError ? (
          <div className="writing-failure" role="alert">
            <p>{strings.writing.loadFailed}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void text.refetch()
              }}
            >
              {strings.writing.retry}
            </button>
          </div>
        ) : (
          <ManuscriptEditor
            chapter={chapter}
            text={text.data}
            warnings={warnings.data?.warnings ?? []}
            streamed={streamed}
            selectedBeat={selectedBeat}
            onSelectBeat={setSelectedBeat}
            focused={focused}
          />
        )}
        <p className="writing-note">{strings.writing.shortcuts}</p>
      </div>
      {warnings.isError ? (
        <aside className="warnings" aria-label={strings.writing.warningsTitle}>
          <p className="writing-failure">{strings.writing.warningsLoadFailed}</p>
          <button
            type="button"
            className="paper-button"
            onClick={() => {
              void warnings.refetch()
            }}
          >
            {strings.writing.retry}
          </button>
        </aside>
      ) : (
        <ConsistencyWarning
          chapter={chapter}
          text={text.data}
          warnings={warnings.data?.warnings ?? []}
          names={names}
          busy={job !== null || regenerate.isPending}
          focused={focused}
          onFocus={(warning) => {
            setFocused(warning)
            setSelectedBeat(warning.beat_id)
          }}
          onSuggest={rewrite}
        />
      )}
    </>
  )
}
