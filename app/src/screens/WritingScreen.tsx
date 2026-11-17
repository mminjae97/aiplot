import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { ChapterPanel } from '../components/ChapterPanel'
import { LeaveEditDialog } from '../components/LeaveEditDialog'
import { isJobActive } from '../components/directionEpisodes'
import { activeJob, chapterGroups, chapterStatus, statusText } from '../components/writingModel'
import { type PlanningScreen, useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import type { Card, EpisodeCard } from '../types'
import type { PageProps } from './PlanningBook'

const isEpisode = (card: Card): card is EpisodeCard => card.type === 'episode'

// As on the direction page: a beat takes about a minute; the list is small and local.
const JOB_POLL_MS = 2000

const WRITING_KEYS = ['chapter:', 'beat:', 'recheck:']

/** S3-1 writing (§10): the chapters on the left, the selected chapter's manuscript in the
 * middle and its warnings on the right. */
export function WritingScreen({
  screen,
  turn,
  onBusy,
  guardLeaving,
}: PageProps<Extract<PlanningScreen, { name: 'writing' }>>) {
  const { workId } = screen
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState<string | null>(null)
  // Failed jobs the reader closed; here so that going to another chapter keeps them closed.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  // A beat holds edits not saved yet (they live only in the editor, §6): leaving it for
  // another chapter or page asks first; `leaving` is the way out the reader asked for.
  const [dirty, setDirty] = useState(false)
  const [leaving, setLeaving] = useState<(() => void) | null>(null)
  // A dialog of the chapter panel is open (the completion summary).
  const [panelBusy, setPanelBusy] = useState(false)
  const ask = useCallback((go: () => void) => {
    setLeaving(() => go)
  }, [])
  // The top bar's setup chip waits too (it leaves the book, not through the page's guard).
  const setEditHeld = useNavigation((store) => store.setEditHeld)
  useEffect(() => {
    guardLeaving(dirty ? ask : null)
    setEditHeld(dirty)
    return () => {
      guardLeaving(null)
      setEditHeld(false)
    }
  }, [ask, dirty, guardLeaving, setEditHeld])
  // The book takes no input while a dialog of this page is open.
  const busy = leaving !== null || panelBusy
  useEffect(() => {
    onBusy(busy)
  }, [busy, onBusy])
  useEffect(
    () => () => {
      onBusy(false)
    },
    [onBusy],
  )

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const started = (work.data?.stage ?? 1) >= 3
  const chapters = useQuery({
    queryKey: ['chapters', workId],
    queryFn: () => api.listChapters(workId),
    enabled: started,
  })
  const episodes = useQuery({
    queryKey: ['cards', workId, 'episode'],
    queryFn: () => api.listCards(workId, { type: 'episode' }),
    enabled: started,
  })
  const cards = useQuery({
    queryKey: ['cards', workId, 'all'],
    queryFn: () => api.listCards(workId),
    enabled: started,
  })
  const jobs = useQuery({
    queryKey: ['jobs', workId],
    queryFn: () => api.listWorkJobs(workId),
    enabled: started,
    refetchInterval: (query) =>
      query.state.data?.jobs.some(isJobActive) === true ? JOB_POLL_MS : false,
  })
  const jobList = jobs.data?.jobs ?? []

  // A writing job that ended changed the manuscript, also one this page never streamed (another
  // chapter's): read it again. By job, not by watching it leave the running list. Jobs already
  // over when the page opens are read again too: a cheap local call against a manuscript read
  // just before the job's end.
  const handled = useRef(new Set<string>())
  useEffect(() => {
    let changed = false
    for (const job of jobs.data?.jobs ?? []) {
      if (isJobActive(job) || handled.current.has(job.jobId)) continue
      handled.current.add(job.jobId)
      if (WRITING_KEYS.some((key) => job.key?.startsWith(key))) changed = true
    }
    if (!changed) return
    void queryClient.invalidateQueries({ queryKey: ['chapters', workId] })
    void queryClient.invalidateQueries({ queryKey: ['chapter'] })
    void queryClient.invalidateQueries({ queryKey: ['warnings'] })
    void queryClient.invalidateQueries({ queryKey: ['versions'] })
  }, [jobs.data, queryClient, workId])

  const list = chapters.data?.chapters ?? []
  const groups = chapterGroups(list, (episodes.data?.cards ?? []).filter(isEpisode))
  const selected =
    list.find((chapter) => chapter.id === chosen) ??
    list.find((chapter) => activeJob(chapter, jobList) !== null) ??
    list.find((chapter) => chapter.beats.some((beat) => beat.version === null)) ??
    list[0]
  // The chapter first shown stays until the reader picks another: one written to its end
  // must not give way to the next unfinished one under the reader's eyes. Not before the jobs
  // are known: the chapter being written comes first.
  if (chosen === null && selected && !jobs.isPending) setChosen(selected.id)
  const names = new Map((cards.data?.cards ?? []).map((card) => [card.id, card.name ?? '']))
  const episodeName = selected
    ? (groups.find((group) => group.chapters.includes(selected))?.episode?.name ?? null)
    : null

  return (
    <article className="spread spread-wide" aria-label={strings.book.notes.writing}>
      <section className="page page-wide writing">
        {work.isError && !work.data && (
          <div className="writing-failure" role="alert">
            <p>{strings.writing.workLoadFailed}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void work.refetch()
              }}
            >
              {strings.writing.retry}
            </button>
          </div>
        )}
        {work.isSuccess && !started && (
          <div className="direction-before">
            <h2>{strings.writing.beforeTitle}</h2>
            <p>{strings.writing.before}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                turn({ name: 'direction', workId })
              }}
            >
              {strings.writing.toDirection}
            </button>
          </div>
        )}
        {started && chapters.isError && !chapters.data && (
          <div className="writing-failure" role="alert">
            <p>{strings.writing.loadFailed}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void chapters.refetch()
              }}
            >
              {strings.writing.retry}
            </button>
          </div>
        )}
        {started && chapters.data && (
          <div className="writing-columns">
            <nav className="writing-chapters" aria-label={strings.writing.chapters}>
              {list.length === 0 && <p className="writing-note">{strings.writing.noChapters}</p>}
              {groups.map((group, at) => (
                <section key={`${group.episode?.id ?? 'none'}-${String(at)}`}>
                  <h3>{group.episode?.name ?? strings.writing.noEpisode}</h3>
                  <ul>
                    {group.chapters.map((chapter) => {
                      const status = chapterStatus(chapter, activeJob(chapter, jobList))
                      return (
                        <li key={chapter.id}>
                          <button
                            type="button"
                            className="writing-chapter"
                            data-status={status}
                            aria-current={selected?.id === chapter.id ? 'true' : undefined}
                            onClick={() => {
                              if (selected?.id === chapter.id) return
                              const go = () => {
                                setChosen(chapter.id)
                              }
                              if (dirty) ask(go)
                              else go()
                            }}
                          >
                            <span>{strings.writing.chapterName(chapter.number)}</span>
                            <small>{statusText(chapter, status)}</small>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </nav>
            {selected && (
              <ChapterPanel
                key={selected.id}
                workId={workId}
                chapter={selected}
                episodeName={episodeName}
                jobs={jobList}
                names={names}
                dismissed={dismissed}
                onDismiss={(jobId) => {
                  setDismissed((old) => new Set(old).add(jobId))
                }}
                onDirty={setDirty}
                onBusy={setPanelBusy}
              />
            )}
          </div>
        )}
      </section>
      {leaving && (
        <LeaveEditDialog
          onStay={() => {
            setLeaving(null)
          }}
          onLeave={() => {
            setLeaving(null)
            setDirty(false)
            // The page's own guard is gone with the edits: the way out goes through.
            guardLeaving(null)
            leaving()
          }}
        />
      )}
    </article>
  )
}
