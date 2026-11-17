import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { isJobActive } from './directionEpisodes'

// As on the direction page: a beat takes about a minute; the list is small and local.
const JOB_POLL_MS = 2000

const WRITING_KEYS = ['chapter:', 'beat:', 'recheck:']

/** The work's jobs, polled while one runs (a chapter may be written in the background, §10).
 * A writing job that ended changed the manuscript, also one this page never streamed: its
 * chapters, texts, warnings and versions are read again. By job, not by watching it leave the
 * running list; jobs already over when the page opens are read again too (a cheap local call
 * against a manuscript read just before the job's end). */
export function useManuscriptJobs(workId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  const jobs = useQuery({
    queryKey: ['jobs', workId],
    queryFn: () => api.listWorkJobs(workId),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.jobs.some(isJobActive) === true ? JOB_POLL_MS : false,
  })
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
  return jobs
}
