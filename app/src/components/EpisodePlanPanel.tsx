import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { EpisodeCard, Job, PlanList, PlanRecord, SceneStatus } from '../types'
import { confirmedScenes, isJobActive } from './directionEpisodes'
import { DualTimeline } from './DualTimeline'
import { narrationOrder } from './dualTimelineLayout'
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
  const [selected, setSelected] = useState<number | null>(null)
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

  const rearrange = useMutation({
    mutationFn: ({ planId, layout }: { planId: string; layout: number[][] }) =>
      api.rearrangePlan(planId, layout),
    onSuccess: (updated) => {
      queryClient.setQueryData<PlanList>(['plans', card.id], { plans: [updated] })
    },
  })

  const failure = job?.status === 'failed' && !dismissed.has(job.jobId) ? job : null
  const startFailure =
    start.error instanceof ApiRequestError
      ? errorText(start.error.code)
      : start.isError
        ? strings.direction.failed
        : null
  const rearrangeFailure =
    rearrange.error instanceof ApiRequestError
      ? errorText(rearrange.error.code)
      : rearrange.isError
        ? strings.direction.rearrangeFailed
        : null
  const actionFailure = startFailure ?? rearrangeFailure
  const notice = actionFailure ?? (failure ? errorText(failure.error?.code ?? '') : null)
  const scenes = record ? narrationOrder(record.plan) : []
  // The picked scene, or the first told (a remade plan may not have the picked one).
  const scene = scenes.find((item) => item.scene === selected) ?? scenes[0]
  const directed = scenes.filter((scene) => scene.status !== 'undirected').length
  const canMake = active && !locked && !running && !loading && !loadFailed
  const step = progress?.step ?? null
  const canArrange = active && !locked && !running && !rearrange.isPending

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
          {record && failure && !actionFailure && (
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

      {record && scene && (
        <>
          <DualTimeline
            plan={record.plan}
            structure={card.data.structure}
            selected={scene.scene}
            onSelect={setSelected}
            onLayout={
              canArrange
                ? (layout) => {
                    rearrange.mutate({ planId: record.id, layout })
                  }
                : null
            }
          />
          <section className="scene-detail" aria-label={strings.direction.sceneName(scene.scene)}>
            <h4>
              {strings.direction.sceneMeta(scene.scene, scene.source, scene.target_chars)}
              <span className="direction-scene-status" data-status={scene.status}>
                {STATUS[scene.status]}
              </span>
            </h4>
            <p>{scene.summary}</p>
            <dl>
              <dt>{strings.direction.core}</dt>
              <dd>{scene.core}</dd>
              {scene.reveal.length > 0 && (
                <>
                  <dt>{strings.direction.reveal}</dt>
                  <dd>
                    <ul>
                      {scene.reveal.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </>
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
