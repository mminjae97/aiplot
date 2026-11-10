import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { EpisodeCard, Job, PlanRecord, SceneStatus } from '../types'
import { confirmedScenes, isJobActive, scenesOf } from './directionEpisodes'
import { GenerationProgress } from './GenerationProgress'
import { ReplacePlanDialog } from './ReplacePlanDialog'
import { useJobProgress } from './useJobProgress'

type Props = {
  workId: string
  card: EpisodeCard
  active: boolean
  /** Direction is over (stage 3): nothing here changes (§11). */
  locked: boolean
  record: PlanRecord | null
  loading: boolean
  /** The plan could not be read: whether the episode has one is unknown. */
  loadFailed: boolean
  onRetryLoad: () => void
  /** Failed jobs the reader has closed. */
  dismissed: ReadonlySet<string>
  onDismiss: (jobId: string) => void
  /** The newest job of this episode's plan, if any is known. */
  job: Job | null
  onBusy: (busy: boolean) => void
}

function errorText(code: string): string {
  return strings.direction.errors[code] ?? strings.drawer.errors[code] ?? strings.direction.failed
}

const STATUS: Record<SceneStatus, string> = strings.direction.sceneStatus

/** The selected episode (§9): its plan, or making one. Making runs as a job on the server, so
 * it carries on while the reader is elsewhere and is picked up again on return. */
export function EpisodePlanPanel({
  workId,
  card,
  active,
  locked,
  record,
  loading,
  loadFailed,
  onRetryLoad,
  dismissed,
  onDismiss,
  job,
  onBusy,
}: Props) {
  const queryClient = useQueryClient()
  const [replacing, setReplacing] = useState(false)
  const running = job !== null && isJobActive(job)
  const progress = useJobProgress(running ? job.jobId : null)

  useEffect(() => {
    onBusy(replacing)
    return () => {
      onBusy(false)
    }
  }, [replacing, onBusy])

  const start = useMutation({
    mutationFn: (replace: boolean) => api.createPlan(card.id, replace),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] }),
  })
  const cancel = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    // The job has usually ended by now; if not, the list says so.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] }),
  })

  const failure = job?.status === 'failed' && !dismissed.has(job.jobId) ? job : null
  const startFailure =
    start.error instanceof ApiRequestError
      ? errorText(start.error.code)
      : start.isError
        ? strings.direction.failed
        : null
  const notice = startFailure ?? (failure ? errorText(failure.error?.code ?? '') : null)
  const scenes = record ? scenesOf(record.plan) : []
  const directed = scenes.filter((scene) => scene.status !== 'undirected').length
  const canMake = active && !locked && !running && !loading && !loadFailed
  const step = progress?.step ?? null

  return (
    <div className="direction-panel">
      <header className="direction-head">
        <h3>{card.name ?? strings.drawer.untitled}</h3>
        {record && (
          <p className="direction-count">
            {strings.direction.confirmedOf(
              confirmedScenes(record).confirmed,
              confirmedScenes(record).total,
            )}
          </p>
        )}
        {record && canMake && (
          <button
            type="button"
            className="paper-button direction-replace"
            onClick={() => {
              start.reset()
              setReplacing(true)
            }}
          >
            {strings.direction.replace}
          </button>
        )}
      </header>
      {card.data.synopsis && <p className="direction-synopsis">{card.data.synopsis}</p>}

      {!active && <p className="direction-note">{strings.direction.inactive}</p>}

      {running && (
        <GenerationProgress
          progress={progress}
          queued={job.status === 'queued'}
          stepLabel={step ? (strings.direction.steps[step] ?? step) : strings.direction.starting}
          usual={strings.direction.usual}
          onCancel={
            cancel.isPending
              ? null
              : () => {
                  cancel.mutate(job.jobId)
                }
          }
        />
      )}

      {notice && (
        <div className="direction-failure" role="alert">
          <p>{notice}</p>
          {record && failure && !startFailure && (
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                onDismiss(failure.jobId)
              }}
            >
              {strings.direction.dismiss}
            </button>
          )}
        </div>
      )}

      {loadFailed && (
        <div className="direction-failure" role="alert">
          <p>{strings.direction.loadFailed}</p>
          <button type="button" className="paper-button" onClick={onRetryLoad}>
            {strings.direction.retry}
          </button>
        </div>
      )}

      {!record && active && !loading && !loadFailed && !running && (
        <div className="direction-empty">
          {locked ? (
            <p className="direction-note">{strings.direction.noPlanLocked}</p>
          ) : (
            <>
              <p className="direction-note">{strings.direction.noPlan}</p>
              <button
                type="button"
                className="paper-button"
                data-primary
                disabled={start.isPending}
                aria-busy={start.isPending}
                onClick={() => {
                  start.mutate(false)
                }}
              >
                {start.isPending && <span className="spinner" aria-hidden="true" />}
                {strings.direction.make}
              </button>
            </>
          )}
        </div>
      )}

      {record && (
        <ol className="direction-chapters">
          {record.plan.chapters.map((chapter) => (
            <li key={chapter.chapter}>
              <h4>{strings.direction.chapter(chapter.chapter, chapter.target_chars)}</h4>
              <ol className="direction-scenes">
                {chapter.scenes.map((scene) => (
                  <li key={scene.scene} data-status={scene.status}>
                    <p className="direction-scene-meta">
                      {strings.direction.sceneMeta(scene.scene, scene.source, scene.target_chars)}
                      <span className="direction-scene-status">{STATUS[scene.status]}</span>
                    </p>
                    <p>{scene.summary}</p>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {replacing && (
        <ReplacePlanDialog
          directed={directed}
          onCancel={() => {
            setReplacing(false)
          }}
          onConfirm={() => {
            setReplacing(false)
            start.mutate(true)
          }}
        />
      )}
    </div>
  )
}
