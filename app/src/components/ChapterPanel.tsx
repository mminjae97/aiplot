import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { BeatSaved, Chapter, Job, Warning } from '../types'
import { BeatEditor } from './BeatEditor'
import { CompletionSummary } from './CompletionSummary'
import { ConsistencyWarning } from './ConsistencyWarning'
import { remaining } from './GenerationProgress'
import { ManuscriptEditor } from './ManuscriptEditor'
import { focusWhenFree } from './useModalKeys'
import { useWritingStream } from './useWritingStream'
import { VersionHistory } from './VersionHistory'
import {
  activeJob,
  latestJobOf,
  latestRecheckOf,
  recheckBeatOf,
  recheckVersionOf,
  recheckedBeats,
  type WritingResult,
  writingResult,
} from './writingModel'

type Props = {
  workId: string
  chapter: Chapter
  episodeName: string | null
  /** All the work's jobs, newest first. */
  jobs: readonly Job[]
  names: ReadonlyMap<string, string>
  /** Failed jobs the reader closed; kept above the panel so they stay closed on return. */
  dismissed: ReadonlySet<string>
  onDismiss: (jobId: string) => void
  /** Whether a beat holds edits not saved yet (the page asks before leaving them). */
  onDirty: (dirty: boolean) => void
  /** Whether a dialog of the panel is open (the book then takes no input). */
  onBusy: (busy: boolean) => void
}

/** Typing in a field: the page's shortcuts stay out of it. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

function errorText(code: string | undefined, fallback: string): string {
  return (code === undefined ? undefined : strings.writing.errors[code]) ?? fallback
}

const failureOf = (error: unknown, fallback: string) =>
  error instanceof ApiRequestError ? errorText(error.code, fallback) : fallback

/** The selected chapter (§10 S3-1): its manuscript with the controls that write it, and its
 * warnings beside it. Writing runs as a job on the server, so it carries on while the reader is
 * elsewhere and streams in again on return. */
export function ChapterPanel({
  workId,
  chapter,
  episodeName,
  jobs,
  names,
  dismissed,
  onDismiss,
  onDirty,
  onBusy,
}: Props) {
  const queryClient = useQueryClient()
  const [selectedBeat, setSelectedBeat] = useState<string | null>(null)
  const [focused, setFocused] = useState<Warning | null>(null)
  const [pauseAsked, setPauseAsked] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [summary, setSummary] = useState<WritingResult | null>(null)
  useEffect(() => {
    onBusy(summary !== null)
  }, [onBusy, summary])
  // Gone (another chapter, or the list could not be read): neither busy nor holding edits.
  useEffect(
    () => () => {
      onBusy(false)
      onDirty(false)
    },
    [onBusy, onDirty],
  )

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
    (jobChanged: boolean) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter', chapter.id] })
      void queryClient.invalidateQueries({ queryKey: ['warnings', chapter.id] })
      void queryClient.invalidateQueries({ queryKey: ['chapters', workId] })
      void queryClient.invalidateQueries({ queryKey: ['versions'] })
      if (jobChanged) void queryClient.invalidateQueries({ queryKey: ['jobs', workId] })
    },
    [chapter.id, queryClient, workId],
  )
  // The job this panel just started: streamed at once, also when it ends before the job list
  // ever shows it running (a short job, or a chapter with one beat left).
  const [launched, setLaunched] = useState<{ jobId: string; kind: string } | null>(null)
  const { streamed, progress } = useWritingStream(
    job?.jobId ?? launched?.jobId ?? null,
    refresh,
    (jobId, data) => {
      // The chapter's own job, seen to its end here (a beat written again ends quietly).
      const kind =
        jobs.find((found) => found.jobId === jobId)?.kind ??
        (launched?.jobId === jobId ? launched.kind : null)
      if (kind !== 'chapter') return
      const result = writingResult(data)
      if (result) setSummary(result)
    },
  )
  const rechecking = recheckedBeats(chapter, jobs)

  const started = (kind: string) => (accepted: { jobId: string }) => {
    setLaunched({ jobId: accepted.jobId, kind })
    return queryClient.invalidateQueries({ queryKey: ['jobs', workId] })
  }
  const generate = useMutation({
    mutationFn: () => api.generateChapter(chapter.id),
    onSuccess: started('chapter'),
  })
  const regenerate = useMutation({
    mutationFn: (beatId: string) => api.regenerateBeat(beatId),
    onSuccess: started('beat'),
  })
  const pause = useMutation({
    mutationFn: (jobId: string) => api.pauseJob(jobId),
    onMutate: (jobId) => {
      setPauseAsked(jobId)
    },
    // Not asked after all (the job ended meanwhile: JOB_NOT_RUNNING).
    onError: () => {
      setPauseAsked(null)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] }),
  })
  const resume = useMutation({
    mutationFn: (jobId: string) => api.resumeJob(jobId),
    onMutate: () => {
      setPauseAsked(null)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] }),
  })
  const stop = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSettled: () => {
      refresh(true)
    },
  })

  // The focus goes back to the beat's margin button once the editor is gone.
  const stopEditing = useCallback(() => {
    const beatId = editing
    setEditing(null)
    onDirty(false)
    if (beatId === null) return
    focusWhenFree(() =>
      document.querySelector(`.ms-beat[data-beat='${CSS.escape(beatId)}'] .ms-mark`),
    )
  }, [editing, onDirty])
  // A new version: its text and warnings again, and the recheck job that checks it (§16).
  const stored = useCallback(
    (_beatId: string, saved: BeatSaved) => {
      refresh(saved.jobId !== null)
    },
    [refresh],
  )
  const save = useMutation({
    mutationFn: ({ beatId, text: edited }: { beatId: string; text: string }) =>
      api.saveBeatText(beatId, edited),
    onSuccess: (saved, { beatId }) => {
      stopEditing()
      stored(beatId, saved)
    },
  })
  // The current text saved again: unchecked, it gets a new recheck job (§16).
  const recheckAgain = useMutation({
    mutationFn: ({ beatId, text: same }: { beatId: string; text: string }) =>
      api.saveBeatText(beatId, same),
    onSuccess: (saved, { beatId }) => {
      stored(beatId, saved)
    },
  })

  const written = new Set(
    (text.data?.beats ?? []).filter((beat) => beat.version !== null).map((b) => b.id),
  )
  const complete = chapter.beats.every((beat) => beat.version !== null)
  const anyWritten = chapter.beats.some((beat) => beat.version !== null)
  const paused = job?.status === 'paused'
  const running = job !== null && job.status !== 'queued'
  // Only a chapter's job stops between beats; a beat written again has no place to stop.
  const pausable = running && job.kind === 'chapter'
  // Paused, or asked to stop at the next beat: either way 계속 takes it back (§16).
  const held = job !== null && (paused || pauseAsked === job.jobId)
  const canRegenerate =
    job === null &&
    editing === null &&
    selectedBeat !== null &&
    written.has(selectedBeat) &&
    !regenerate.isPending
  // Any beat, written or not (§16: a beat without text may be written by hand), while no job
  // writes the chapter (else 409 BEAT_BUSY), and from its current text: not while that is still
  // read (after a save or a restore the editor would open on the version before).
  const canEdit =
    job === null &&
    editing === null &&
    !regenerate.isPending &&
    !generate.isPending &&
    text.isSuccess &&
    !text.isFetching

  const edit = useCallback(
    (beatId: string) => {
      if (!canEdit) return
      save.reset()
      setSelectedBeat(beatId)
      setEditing(beatId)
    },
    [canEdit, save],
  )

  const togglePause = useCallback(() => {
    if (!job || !pausable || pause.isPending || resume.isPending) return
    if (held) resume.mutate(job.jobId)
    else pause.mutate(job.jobId)
  }, [job, pausable, held, pause, resume])

  const rewrite = useCallback(
    (beatId: string) => {
      if (job !== null || editing !== null || regenerate.isPending) return
      generate.reset()
      setSelectedBeat(beatId)
      regenerate.mutate(beatId)
    },
    [editing, generate, job, regenerate],
  )

  // Ctrl+. pauses or resumes, Ctrl+Shift+R writes the picked beat again (§12 shortcuts).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.repeat) return
      // Not under a dialog, nor while typing.
      if (summary !== null || typing(event.target)) return
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
  }, [canRegenerate, rewrite, selectedBeat, summary, togglePause])

  // The newest job that failed and was not closed: one writing the chapter, or one checking a
  // saved beat again (that beat stays unchecked: a save of its text checks it again, §16).
  const latest = latestJobOf(chapter, jobs)
  const recheck = latestRecheckOf(chapter, jobs)
  // Only while it is still owed: the version it failed on is the beat's current one and is
  // unchecked (a later save, rewrite or a check stored before the summaries failed settles it).
  const checked = text.data?.beats.find((beat) => beat.id === (recheck && recheckBeatOf(recheck)))
  const owed =
    recheck !== null &&
    checked !== undefined &&
    checked.version === recheckVersionOf(recheck) &&
    checked.checked === false
  const failedJob = [latest, owed ? recheck : null].find(
    (found) => found?.status === 'failed' && !dismissed.has(found.jobId),
  )
  const failedBeat = failedJob?.kind === 'recheck' ? recheckBeatOf(failedJob) : null
  const failedText = text.data?.beats.find((beat) => beat.id === failedBeat)?.text ?? null
  const jobFailure = !failedJob
    ? null
    : failedJob.kind === 'recheck'
      ? `${strings.writing.recheckFailed} ${errorText(failedJob.error?.code, '')}`.trim()
      : errorText(failedJob.error?.code, strings.writing.failed)
  const actionError =
    generate.error ??
    regenerate.error ??
    pause.error ??
    resume.error ??
    stop.error ??
    recheckAgain.error
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
              disabled={generate.isPending || editing !== null}
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
            disabled={!pausable || pause.isPending || resume.isPending}
            aria-keyshortcuts="Control+."
            onClick={togglePause}
          >
            {held ? strings.writing.resumeJob : strings.writing.pause}
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
          <button
            type="button"
            className="paper-button"
            disabled={!canEdit || selectedBeat === null}
            title={selectedBeat === null ? strings.writing.editHint : undefined}
            onClick={() => {
              if (selectedBeat !== null) edit(selectedBeat)
            }}
          >
            {strings.writing.edit}
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
            {!actionError && failedBeat !== null && failedText !== null && (
              <button
                type="button"
                className="paper-button"
                disabled={recheckAgain.isPending || job !== null}
                onClick={() => {
                  recheckAgain.mutate({ beatId: failedBeat, text: failedText })
                }}
              >
                {strings.writing.recheckAgain}
              </button>
            )}
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                generate.reset()
                regenerate.reset()
                pause.reset()
                resume.reset()
                stop.reset()
                recheckAgain.reset()
                if (failedJob) onDismiss(failedJob.jobId)
              }}
            >
              {strings.writing.dismiss}
            </button>
          </div>
        )}
        {text.isError && !text.data ? (
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
            rechecking={rechecking}
            editing={editing}
            editor={
              editing !== null && (
                <BeatEditor
                  key={editing}
                  order={chapter.beats.find((beat) => beat.id === editing)?.order ?? 0}
                  text={text.data?.beats.find((beat) => beat.id === editing)?.text ?? ''}
                  saving={save.isPending}
                  error={save.error ? failureOf(save.error, strings.writing.saveFailed) : null}
                  onSave={(edited) => {
                    save.mutate({ beatId: editing, text: edited })
                  }}
                  onCancel={stopEditing}
                  onDirty={onDirty}
                />
              )
            }
            onEditBeat={canEdit ? edit : null}
          />
        )}
        <p className="writing-note">{strings.writing.shortcuts}</p>
      </div>
      <div className="writing-side">
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
            busy={job !== null || editing !== null || regenerate.isPending}
            focused={focused}
            onFocus={(warning) => {
              setFocused(warning)
              setSelectedBeat(warning.beat_id)
            }}
            onSuggest={rewrite}
          />
        )}
        <VersionHistory
          key={selectedBeat ?? ''}
          beat={chapter.beats.find((beat) => beat.id === selectedBeat) ?? null}
          busy={job !== null || editing !== null}
          onRestored={stored}
        />
      </div>
      {summary && (
        <CompletionSummary
          chapterNumber={chapter.number}
          result={summary}
          chars={chapter.chars}
          target={chapter.target_chars}
          onClose={() => {
            setSummary(null)
          }}
        />
      )}
    </>
  )
}
