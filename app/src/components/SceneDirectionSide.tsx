import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { PlanList, PlanRecord, PlanScene, TechniqueDevice } from '../types'
import { DeviceChecklist } from './DeviceChecklist'
import { planSaveScope } from './directionEpisodes'
import { sameCards } from './directionPicks'
import { DirectionConfirmDialog } from './DirectionConfirmDialog'
import { TechniqueCardPicker } from './TechniqueCardPicker'

type Props = {
  episodeId: string
  record: PlanRecord
  scene: PlanScene
  readOnly: boolean
  keysActive: boolean
  onBusy: (busy: boolean) => void
  onDirect: () => void
}

function refusalText(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError
    ? (strings.direction.errors[error.code] ?? fallback)
    : fallback
}

/** Keys of the plan with one scene's checked devices replaced: what a click shows at once. */
function withDevices(list: PlanList, scene: number, devices: TechniqueDevice[]): PlanList {
  return {
    plans: list.plans.map((record) => ({
      ...record,
      plan: {
        ...record.plan,
        chapters: record.plan.chapters.map((chapter) => ({
          ...chapter,
          scenes: chapter.scenes.map((item) =>
            item.scene === scene ? { ...item, devices } : item,
          ),
        })) as PlanRecord['plan']['chapters'],
      },
    })),
  }
}

/** The right column of S2 (§9): correct the scene's devices, then pick its technique cards. */
export function SceneDirectionSide({
  episodeId,
  record,
  scene,
  readOnly,
  keysActive,
  onBusy,
  onDirect,
}: Props) {
  const queryClient = useQueryClient()
  const planKey = ['plans', episodeId]
  const devicesKey = ['plan-devices', record.id]
  // One save at a time, in order: each device save sends the whole list, so the last click
  // must win, and each answer is the whole plan.
  const saveScope = planSaveScope(record.id)
  // The cards to direct with, waiting for the answer to "replace the beats?".
  const [redirecting, setRedirecting] = useState<string[] | null>(null)

  useEffect(() => {
    onBusy(redirecting !== null)
    return () => {
      onBusy(false)
    }
  }, [redirecting, onBusy])

  const saveDevices = useMutation({
    mutationKey: devicesKey,
    scope: { id: saveScope },
    mutationFn: (devices: TechniqueDevice[]) =>
      api.setSceneDevices(record.id, scene.scene, devices),
    onMutate: (devices) => {
      queryClient.setQueryData<PlanList>(planKey, (list) =>
        list ? withDevices(list, scene.scene, devices) : list,
      )
    },
    onSuccess: (updated) => {
      // A later click is still on its way: its optimistic state stays until it answers.
      if (queryClient.isMutating({ mutationKey: devicesKey }) <= 1) {
        queryClient.setQueryData<PlanList>(planKey, { plans: [updated] })
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: planKey }),
  })

  const pick = useMutation({
    scope: { id: saveScope },
    mutationFn: (techniques: string[]) => api.pickTechniques(record.id, scene.scene, techniques),
    onSuccess: (updated) => {
      // A device click still on its way shows at once, and its answer carries these cards.
      if (queryClient.isMutating({ mutationKey: devicesKey }) === 0) {
        queryClient.setQueryData<PlanList>(planKey, { plans: [updated] })
      }
    },
  })

  /** Saves the cards if they changed, then directs the scene with them (§9). */
  const direct = (techniques: string[]) => {
    if (sameCards(techniques, scene.chosen)) onDirect()
    else pick.mutate(techniques, { onSuccess: onDirect })
  }

  const failure = saveDevices.isError
    ? refusalText(saveDevices.error, strings.direction.devicesFailed)
    : pick.isError
      ? refusalText(pick.error, strings.direction.pickFailed)
      : null

  return (
    <aside className="direction-side" aria-label={strings.direction.sideTitle}>
      <DeviceChecklist
        scene={scene}
        disabled={readOnly}
        onChange={(devices) => {
          saveDevices.mutate(devices)
        }}
      />
      <div className="direction-side-picks">
        {failure && (
          <p className="pick-refusal" role="alert">
            {failure}
          </p>
        )}
        <TechniqueCardPicker
          scene={scene}
          disabled={readOnly}
          keysActive={keysActive && redirecting === null}
          saving={pick.isPending}
          hasBeats={scene.beats.length > 0}
          onConfirm={(techniques) => {
            if (scene.beats.length > 0) setRedirecting(techniques)
            else direct(techniques)
          }}
        />
      </div>
      {redirecting && (
        <DirectionConfirmDialog
          title={strings.direction.redirectTitle}
          what={strings.direction.redirectWhat}
          confirmLabel={strings.direction.redirect}
          onCancel={() => {
            setRedirecting(null)
          }}
          onConfirm={() => {
            direct(redirecting)
            setRedirecting(null)
          }}
        />
      )}
    </aside>
  )
}
