import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type {
  BeatEdit,
  JobProgressEvent,
  Job,
  PlanBeat,
  PlanList,
  PlanRecord,
  PlanScene,
} from '../types'
import { BeatList } from './BeatList'
import { allowedCards, toEdit } from './beatEdits'
import { directionErrorText, planSaveScope } from './directionEpisodes'
import { GenerationProgress } from './GenerationProgress'

type Props = {
  episodeId: string
  record: PlanRecord
  scene: PlanScene
  /** Locked, inactive, or the plan or this scene being made. */
  readOnly: boolean
  directJob: Job | null
  directRunning: boolean
  progress: JobProgressEvent | null
  startFailure: unknown
  dismissed: ReadonlySet<string>
  onDismiss: (jobId: string) => void
  onCancelJob: (jobId: string) => void
}

function withBeats(list: PlanList, scene: number, beats: PlanBeat[]): PlanList {
  return {
    plans: list.plans.map((record) => ({
      ...record,
      plan: {
        ...record.plan,
        chapters: record.plan.chapters.map((chapter) => ({
          ...chapter,
          scenes: chapter.scenes.map((item) => (item.scene === scene ? { ...item, beats } : item)),
        })) as PlanRecord['plan']['chapters'],
      },
    })),
  }
}

function textOf(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? directionErrorText(error.code) : fallback
}

/** The selected scene's beats (§9): directing it, editing what comes back, confirming it. */
export function SceneBeats({
  episodeId,
  record,
  scene,
  readOnly,
  directJob,
  directRunning,
  progress,
  startFailure,
  dismissed,
  onDismiss,
  onCancelJob,
}: Props) {
  const queryClient = useQueryClient()
  const planKey = ['plans', episodeId]
  const beatsKey = ['plan-beats', record.id]

  const saveBeats = useMutation({
    mutationKey: beatsKey,
    scope: { id: planSaveScope(record.id) },
    mutationFn: ({ beats }: { beats: PlanBeat[]; scene: number }) =>
      api.setSceneBeats(record.id, scene.scene, beats.map(toEdit) as [BeatEdit, ...BeatEdit[]]),
    onMutate: ({ beats, scene: number }) => {
      queryClient.setQueryData<PlanList>(planKey, (list) =>
        list ? withBeats(list, number, beats) : list,
      )
    },
    onSuccess: (updated) => {
      // A later edit is still on its way: what it showed stays until it answers.
      if (queryClient.isMutating({ mutationKey: beatsKey }) <= 1) {
        queryClient.setQueryData<PlanList>(planKey, { plans: [updated] })
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: planKey }),
  })
  const confirm = useMutation({
    scope: { id: planSaveScope(record.id) },
    mutationFn: () => api.confirmScene(record.id, scene.scene),
    onSuccess: (updated) => {
      queryClient.setQueryData<PlanList>(planKey, { plans: [updated] })
    },
  })

  // A new direction replaces the beats those errors were about.
  const { reset: resetSave } = saveBeats
  const { reset: resetConfirm } = confirm
  useEffect(() => {
    if (directRunning) {
      resetSave()
      resetConfirm()
    }
  }, [directRunning, resetSave, resetConfirm])

  const failedJob =
    directJob?.status === 'failed' && !dismissed.has(directJob.jobId) ? directJob : null
  const failure = saveBeats.isError
    ? textOf(saveBeats.error, strings.direction.beatsFailed)
    : confirm.isError
      ? textOf(confirm.error, strings.direction.confirmFailed)
      : startFailure
        ? textOf(startFailure, strings.direction.directFailed)
        : null
  const notice = failure ?? (failedJob ? directionErrorText(failedJob.error?.code ?? '') : null)
  const canConfirm = !readOnly && !directRunning && scene.status === 'directed'
  const editable = !readOnly && !directRunning

  return (
    <section className="scene-beats" aria-label={strings.direction.beatsTitle}>
      {directRunning && directJob && (
        <GenerationProgress
          progress={progress}
          queued={directJob.status === 'queued'}
          stepLabel={strings.direction.directing}
          usual={strings.direction.directUsual}
          onCancel={() => {
            onCancelJob(directJob.jobId)
          }}
        />
      )}
      {notice && (
        <div className="direction-failure" role="alert">
          <p>{notice}</p>
          {failedJob && !failure && (
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                onDismiss(failedJob.jobId)
              }}
            >
              {strings.direction.dismiss}
            </button>
          )}
        </div>
      )}
      {scene.beats.length > 0 && (
        <>
          <BeatList
            plan={record.plan}
            scene={scene}
            disabled={!editable}
            onBeats={(beats) => {
              // A stale scene's beats may still name cards its new place or picks no longer
              // allow; the server refuses those, and the list offers no way to take them off.
              const allowed = allowedCards(record.plan, scene)
              saveBeats.mutate({
                beats: beats.map((beat) => ({
                  ...beat,
                  techniques: beat.techniques.filter((id) => allowed.includes(id)),
                })),
                scene: scene.scene,
              })
            }}
          />
          <div className="scene-confirm">
            <button
              type="button"
              className="paper-button"
              data-primary
              disabled={!canConfirm || confirm.isPending}
              aria-busy={confirm.isPending}
              onClick={() => {
                confirm.mutate()
              }}
            >
              {confirm.isPending && <span className="spinner" aria-hidden="true" />}
              {scene.status === 'confirmed'
                ? strings.direction.confirmed
                : strings.direction.confirmScene}
            </button>
            {scene.status === 'stale' && <small>{strings.direction.confirmStale}</small>}
          </div>
        </>
      )}
    </section>
  )
}
