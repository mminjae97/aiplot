import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ChapterReader } from '../components/ChapterReader'
import { useManuscriptJobs } from '../components/useManuscriptJobs'
import {
  continueAt,
  isFinished,
  listed,
  neighbours,
  type ReaderType,
  type ReadingOrder,
  saveOrder,
  savedOrder,
  savedType,
  saveType,
} from '../components/readingModel'
import type { PlanningScreen } from '../stores/navigation'
import { strings } from '../strings'
import type { Chapter, ChapterList, ChapterUpdate } from '../types'
import type { PageProps } from './PlanningBook'

/** Typing in a field: the page's keys stay out of it. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** 소설 읽기 (§12 S3-2, S3-3): the chapters on the left page (read ones bold, newest or oldest
 * first, 읽음 toggled, 이어 읽기), the chapter opened on the right. */
export function ReadingScreen({
  screen,
  turn,
}: PageProps<Extract<PlanningScreen, { name: 'reading' }>>) {
  const { workId } = screen
  const queryClient = useQueryClient()
  const [order, setOrder] = useState<ReadingOrder>(savedOrder)
  const [type, setType] = useState<ReaderType>(savedType)
  // The chapter open and where it opened (the share of its text scrolled past).
  const [open, setOpen] = useState<{ id: string; at: number } | null>(null)

  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const started = (work.data?.stage ?? 1) >= 3
  const chapters = useQuery({
    queryKey: ['chapters', workId],
    queryFn: () => api.listChapters(workId),
    enabled: started,
  })
  const list = chapters.data?.chapters ?? []

  // A writing job in the background (§10) adds chapters to read and changes their text.
  useManuscriptJobs(workId, started)

  // A mark stored: only the keys it sent are taken from the answer (another mark may be on its
  // way), and a list read before it was stored must not put the old value back.
  const stored = (chapter: Chapter, body: ChapterUpdate) => {
    void queryClient.cancelQueries({ queryKey: ['chapters', workId] })
    const sent = {
      ...(body.read === undefined ? {} : { read: chapter.read }),
      ...(body.position === undefined ? {} : { position: chapter.position }),
    }
    queryClient.setQueryData<ChapterList>(['chapters', workId], (old) =>
      old
        ? { chapters: old.chapters.map((c) => (c.id === chapter.id ? { ...c, ...sent } : c)) }
        : old,
    )
  }
  const mark = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChapterUpdate }) => api.markChapter(id, body),
    onSuccess: (chapter, { body }) => {
      stored(chapter, body)
    },
  })
  // Where reading stopped is saved quietly: one lost only opens 이어 읽기 a little earlier.
  const keepPosition = (id: string, position: number) => {
    api.markChapter(id, { position }).then(
      (chapter) => {
        stored(chapter, { position })
      },
      () => undefined,
    )
  }

  const current = list.find((chapter) => chapter.id === open?.id && isFinished(chapter)) ?? null
  const around = current ? neighbours(list, current.id) : { prev: null, next: null }
  const resume = continueAt(list)
  const openChapter = (chapter: Chapter, at = 0) => {
    setOpen({ id: chapter.id, at })
  }

  // ← and → open the chapters before and after the one open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      if (typing(event.target)) return
      const target =
        event.key === 'ArrowLeft' ? around.prev : event.key === 'ArrowRight' ? around.next : null
      if (!target) return
      event.preventDefault()
      setOpen({ id: target.id, at: 0 })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [around.prev, around.next])

  const markError = mark.isError ? strings.reading.markFailed : null

  return (
    <article className="spread reading" aria-label={strings.book.notes.reading}>
      <section className="page page-left reading-list">
        <h2 className="contents-heading">{strings.reading.title}</h2>
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
              {strings.reading.retry}
            </button>
          </div>
        )}
        {work.isSuccess && !started && (
          <div className="direction-before">
            <h3>{strings.reading.beforeTitle}</h3>
            <p>{strings.reading.before}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                turn({ name: 'writing', workId })
              }}
            >
              {strings.reading.toWriting}
            </button>
          </div>
        )}
        {started && chapters.isError && !chapters.data && (
          <div className="writing-failure" role="alert">
            <p>{strings.reading.listLoadFailed}</p>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                void chapters.refetch()
              }}
            >
              {strings.reading.retry}
            </button>
          </div>
        )}
        {started && chapters.data && (
          <>
            <div className="reading-tools">
              <button
                type="button"
                className="paper-button"
                disabled={resume === null}
                title={resume ? strings.reading.continueHint(resume.number) : undefined}
                onClick={() => {
                  if (resume) openChapter(resume, resume.position)
                }}
              >
                {strings.reading.continue}
              </button>
              <label>
                {strings.reading.sort}{' '}
                <select
                  value={order}
                  onChange={(event) => {
                    const next = event.target.value === 'oldest' ? 'oldest' : 'newest'
                    setOrder(next)
                    saveOrder(next)
                  }}
                >
                  <option value="newest">{strings.reading.newest}</option>
                  <option value="oldest">{strings.reading.oldest}</option>
                </select>
              </label>
            </div>
            {!list.some(isFinished) && <p className="writing-note">{strings.reading.none}</p>}
            {list.some(isFinished) && resume === null && (
              <p className="writing-note">{strings.reading.allRead}</p>
            )}
            {markError && (
              <p className="writing-failure" role="alert">
                {markError}
              </p>
            )}
            <ul className="reading-chapters" aria-label={strings.reading.chapters}>
              {listed(list, order).map((chapter) => {
                const finished = isFinished(chapter)
                const name = strings.reading.chapterName(chapter.number)
                const started = chapter.beats.some((beat) => beat.version !== null)
                const status = !finished
                  ? started
                    ? strings.reading.writing
                    : strings.reading.notWritten
                  : chapter.read
                    ? strings.reading.read
                    : strings.reading.unread
                return (
                  <li
                    key={chapter.id}
                    data-read={(finished && chapter.read) || undefined}
                    data-finished={finished || undefined}
                  >
                    <button
                      type="button"
                      className="reading-chapter"
                      disabled={!finished}
                      aria-current={current?.id === chapter.id ? 'true' : undefined}
                      onClick={() => {
                        openChapter(chapter)
                      }}
                    >
                      <span>{name}</span>
                      <small>{status}</small>
                    </button>
                    <input
                      type="checkbox"
                      aria-label={strings.reading.readMark(chapter.number)}
                      checked={finished && chapter.read}
                      disabled={!finished || mark.isPending}
                      onChange={(event) => {
                        // Unread again: 이어 읽기 then opens it from its start.
                        const read = event.target.checked
                        mark.mutate({
                          id: chapter.id,
                          body: read ? { read } : { read, position: 0 },
                        })
                      }}
                    />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
      <section className="page page-right reading-page">
        {current ? (
          <ChapterReader
            key={`${current.id}:${String(open?.at ?? 0)}`}
            chapter={current}
            startAt={open?.at ?? 0}
            prev={around.prev}
            next={around.next}
            type={type}
            onType={(next) => {
              setType(next)
              saveType(next)
            }}
            onOpen={(chapter) => {
              openChapter(chapter)
            }}
            onPosition={(share) => {
              keepPosition(current.id, share)
            }}
            onEnd={() => {
              if (!current.read) mark.mutate({ id: current.id, body: { read: true } })
            }}
          />
        ) : (
          started && chapters.data && <p className="writing-note">{strings.reading.pick}</p>
        )}
      </section>
    </article>
  )
}
