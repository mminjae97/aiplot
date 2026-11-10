import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Job } from '../types'
import { directJobKey, isJobActive, latestJob } from './directionEpisodes'
import { useJobProgress } from './useJobProgress'

/** The job directing a scene (§16): the newest one of its key, and starting another. */
export function useSceneDirect(
  workId: string,
  planId: string | null,
  scene: number | null,
  jobs: readonly Job[],
) {
  const queryClient = useQueryClient()
  const job =
    planId !== null && scene !== null ? latestJob(jobs, directJobKey(planId, scene)) : null
  const running = job !== null && isJobActive(job)
  const progress = useJobProgress(running ? job.jobId : null)
  const start = useMutation({
    mutationFn: (target: { planId: string; scene: number }) =>
      api.directScene(target.planId, target.scene),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs', workId] }),
  })
  return { job, running, progress, start }
}
