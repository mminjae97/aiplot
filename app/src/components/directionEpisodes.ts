// The S2 episode list (§9, §11): episodes in reading order, grouped by part, and what the
// server's active test says about each.
import type { DirectionPlan, EpisodeCard, Job, PartCard, PlanRecord } from '../types'

export type EpisodeRow = { card: EpisodeCard; active: boolean }
export type EpisodeGroup = { part: PartCard | null; episodes: EpisodeRow[] }

const byOrder = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? Infinity) - (b ?? Infinity)

/** Parts in order, each with its episodes in order; episodes with no known part come last.
 * Active as the server has it (§11): the episode, its part and the main story are complete. */
export function episodeGroups(
  parts: readonly PartCard[],
  episodes: readonly EpisodeCard[],
  mainComplete: boolean,
): EpisodeGroup[] {
  const known = new Map(parts.map((part) => [part.id, part]))
  const inPart = (part: PartCard | null): EpisodeRow[] =>
    episodes
      .filter((card) =>
        part === null ? !known.has(card.data.part_id ?? '') : card.data.part_id === part.id,
      )
      .sort((a, b) => byOrder(a.data.order, b.data.order))
      .map((card) => ({
        card,
        active:
          mainComplete && part !== null && part.status === 'complete' && card.status === 'complete',
      }))
  const ordered = [...parts].sort((a, b) => byOrder(a.data.order, b.data.order))
  const groups = ordered.map((part) => ({ part, episodes: inPart(part) }))
  const lost = inPart(null)
  return [...groups, ...(lost.length > 0 ? [{ part: null, episodes: lost }] : [])].filter(
    (group) => group.episodes.length > 0,
  )
}

export function scenesOf(plan: DirectionPlan) {
  return plan.chapters.flatMap((chapter) => chapter.scenes)
}

/** How many of the plan's scenes are confirmed (§9), of how many. */
export function confirmedScenes(record: PlanRecord): { confirmed: number; total: number } {
  const scenes = scenesOf(record.plan)
  return {
    confirmed: scenes.filter((scene) => scene.status === 'confirmed').length,
    total: scenes.length,
  }
}

/** The job key of an episode's plan job (§16, the server's plans.start_new). */
export const planJobKey = (episodeId: string) => `plan:${episodeId}`

/** The episode a job plans, if it is a plan job. */
export function planJobEpisode(job: Job): string | null {
  return job.key?.startsWith('plan:') ? job.key.slice('plan:'.length) : null
}

export const isJobActive = (job: Job) =>
  job.status === 'queued' || job.status === 'running' || job.status === 'paused'

/** The newest job of a key: the server lists a work's jobs newest first. */
export function latestJob(jobs: readonly Job[], key: string): Job | null {
  return jobs.find((job) => job.key === key) ?? null
}
