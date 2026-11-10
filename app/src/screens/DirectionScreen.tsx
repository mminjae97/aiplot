import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import {
  confirmedScenes,
  episodeGroups,
  isJobActive,
  latestJob,
  planJobEpisode,
  planJobKey,
} from '../components/directionEpisodes'
import { EpisodePlanPanel } from '../components/EpisodePlanPanel'
import type { PlanningScreen } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, EpisodeCard, Job, MainStoryCard, PartCard, PlanRecord } from '../types'
import type { PageProps } from './PlanningBook'

const isMain = (card: Card): card is MainStoryCard => card.type === 'main_story'
const isPart = (card: Card): card is PartCard => card.type === 'part'
const isEpisode = (card: Card): card is EpisodeCard => card.type === 'episode'

// Plenty for a job that takes minutes; the list is small and local.
const JOB_POLL_MS = 2000

function rowStatus(active: boolean, job: Job | null, record: PlanRecord | null): string {
  if (!active) return strings.direction.rowInactive
  if (job && isJobActive(job)) {
    return job.status === 'queued' ? strings.direction.rowQueued : strings.direction.rowMaking
  }
  if (!record) return strings.direction.rowNoPlan
  if (record.status === 'confirmed') return strings.direction.rowConfirmed
  const { confirmed, total } = confirmedScenes(record)
  return strings.direction.rowProgress(confirmed, total)
}

/** S2 direction (§9): the episodes on the left, the selected episode's plan beside them. */
export function DirectionScreen({
  screen,
  turn,
  onBusy,
}: PageProps<Extract<PlanningScreen, { name: 'direction' }>>) {
  const { workId } = screen
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState<string | null>(null)
  // Failed jobs the reader closed; here so that going to another episode keeps them closed.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const mains = useQuery({
    queryKey: ['cards', workId, 'main_story'],
    queryFn: () => api.listCards(workId, { type: 'main_story' }),
  })
  const partCards = useQuery({
    queryKey: ['cards', workId, 'part'],
    queryFn: () => api.listCards(workId, { type: 'part' }),
  })
  const episodeCards = useQuery({
    queryKey: ['cards', workId, 'episode'],
    queryFn: () => api.listCards(workId, { type: 'episode' }),
  })
  const jobs = useQuery({
    queryKey: ['jobs', workId],
    queryFn: () => api.listWorkJobs(workId),
    refetchInterval: (query) =>
      query.state.data?.jobs.some(isJobActive) === true ? JOB_POLL_MS : false,
  })
  const jobList = jobs.data?.jobs ?? []

  const started = (work.data?.stage ?? 1) >= 2
  const locked = (work.data?.locked_stage ?? 0) >= 2
  const mainComplete = (mains.data?.cards ?? []).filter(isMain).some((c) => c.status === 'complete')
  const groups = episodeGroups(
    (partCards.data?.cards ?? []).filter(isPart),
    (episodeCards.data?.cards ?? []).filter(isEpisode),
    mainComplete,
  )
  const rows = groups.flatMap((group) => group.episodes)
  const activeIds = rows.filter((row) => row.active).map((row) => row.card.id)

  const planQueries = useQueries({
    queries: activeIds.map((id) => ({
      queryKey: ['plans', id],
      queryFn: () => api.listPlans(id),
      enabled: started,
      // Only this page changes plans; a refetch on focus would only flicker the make button.
      refetchOnWindowFocus: false,
    })),
  })
  const planOf = new Map(activeIds.map((id, at) => [id, planQueries[at]]))
  const recordOf = (id: string) => planOf.get(id)?.data?.plans[0] ?? null

  // A finished job changed a plan: a plan job its episode's, a direction job one of the
  // plans. By job, not by watching one leave the running list: a job can be over before the
  // list first shows it.
  const handledJobs = useRef(new Set<string>())
  useEffect(() => {
    for (const job of jobs.data?.jobs ?? []) {
      if (job.status !== 'done' || job.key === null || handledJobs.current.has(job.jobId)) continue
      handledJobs.current.add(job.jobId)
      const episodeId = planJobEpisode(job)
      void queryClient.invalidateQueries({
        queryKey: episodeId === null ? ['plans'] : ['plans', episodeId],
      })
    }
  }, [jobs.data, queryClient])

  const selected =
    rows.find((row) => row.card.id === chosen) ?? rows.find((row) => row.active) ?? rows[0]
  const loaded = work.isSuccess && mains.isSuccess && partCards.isSuccess && episodeCards.isSuccess

  return (
    <article className="spread spread-wide" aria-label={strings.book.notes.direction}>
      <section className="page page-wide direction">
        {loaded && !started && (
          <div className="direction-before">
            <h2>{strings.direction.beforeTitle}</h2>
            <p>{strings.direction.before}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                turn({ name: 'story', workId })
              }}
            >
              {strings.direction.toStory}
            </button>
          </div>
        )}
        {loaded && started && (
          <div className="direction-columns">
            <nav className="direction-episodes" aria-label={strings.direction.episodes}>
              {groups.map((group) => (
                <section key={group.part?.id ?? 'none'}>
                  <h3>{group.part?.data.title ?? strings.direction.noPart}</h3>
                  <ul>
                    {group.episodes.map(({ card, active }) => (
                      <li key={card.id}>
                        <button
                          type="button"
                          className="direction-episode"
                          data-inactive={active ? undefined : ''}
                          aria-current={selected?.card.id === card.id ? 'true' : undefined}
                          onClick={() => {
                            setChosen(card.id)
                          }}
                        >
                          <span>{card.name ?? strings.drawer.untitled}</span>
                          <small>
                            {rowStatus(
                              active,
                              latestJob(jobList, planJobKey(card.id)),
                              recordOf(card.id),
                            )}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
            {selected && (
              <EpisodePlanPanel
                key={selected.card.id}
                workId={workId}
                card={selected.card}
                active={selected.active}
                locked={locked}
                record={recordOf(selected.card.id)}
                // Also while refetching: a job just done has a plan the list does not show yet.
                loading={planOf.get(selected.card.id)?.isFetching !== false}
                loadFailed={planOf.get(selected.card.id)?.isError === true}
                onRetryLoad={() => {
                  void planOf.get(selected.card.id)?.refetch()
                }}
                dismissed={dismissed}
                onDismiss={(jobId) => {
                  setDismissed((old) => new Set(old).add(jobId))
                }}
                job={latestJob(jobList, planJobKey(selected.card.id))}
                jobs={jobList}
                onBusy={onBusy}
              />
            )}
          </div>
        )}
      </section>
    </article>
  )
}
