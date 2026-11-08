import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { StageAdvancePreview, StageReopen, Work } from '../types'
import { useModalKeys } from './useModalKeys'
import { cleanTitle } from './workTitle'

export type StageAction = { kind: 'advance' } | { kind: 'reopen'; stage: StageReopen['stage'] }

type Props = {
  work: Work
  action: StageAction
  onClose: () => void
  onDone: (work: Work) => void
}

/** The lock warning (§11): before a stage starts, what it locks and what turns inactive; before
 * a locked stage reopens, what is deleted, in counts. The red button is never the default (the
 * focus starts on 취소), and a reopen that deletes a manuscript waits for the title typed. */
export function StageLockDialog({ work, action, onClose, onDone }: Props) {
  const box = useRef<HTMLFormElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const queryClient = useQueryClient()
  const reopenStage = action.kind === 'reopen' ? action.stage : null

  const advancePreview = useQuery({
    queryKey: ['stage-preview', work.id, 'advance'],
    queryFn: () => api.advancePreview(work.id),
    enabled: action.kind === 'advance',
    gcTime: 0,
  })
  const reopenPreview = useQuery({
    queryKey: ['stage-preview', work.id, 'reopen', reopenStage],
    queryFn: () => api.reopenPreview(work.id, reopenStage ?? 1),
    enabled: reopenStage !== null,
    gcTime: 0,
  })
  const run = useMutation({
    mutationFn: () =>
      reopenStage === null
        ? api.advanceStage(work.id)
        : api.reopenStage(work.id, { stage: reopenStage, title: typed }),
    onSuccess: (changed) => {
      queryClient.setQueryData(['works', work.id], changed)
      void queryClient.invalidateQueries({ queryKey: ['works'] })
    },
  })

  useModalKeys(box, onClose, cancel)

  const preview = action.kind === 'advance' ? advancePreview : reopenPreview
  const titleRequired = reopenPreview.data?.title_required ?? false
  const ready =
    action.kind === 'advance'
      ? (advancePreview.data?.active_episodes ?? 0) > 0
      : reopenPreview.isSuccess && (!titleRequired || cleanTitle(typed) === work.title)

  const confirm = () => {
    if (!ready || run.isPending) return
    run.mutate(undefined, { onSuccess: onDone })
  }
  // Enter never confirms (§5): only a click (or Space/Enter on the red button itself) does.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  const failure =
    run.error instanceof ApiRequestError && run.error.code === 'SNAPSHOT_FAILED'
      ? strings.stageLock.snapshotFailed
      : action.kind === 'advance'
        ? strings.stageLock.startFailed
        : strings.stageLock.reopenFailed

  const stageName = strings.stage[reopenStage ?? 1]
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        ref={box}
        className="new-book stage-lock"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stage-lock-title"
        aria-describedby="stage-lock-what"
        aria-busy={preview.isPending}
        onSubmit={submit}
      >
        <h2 id="stage-lock-title">
          {action.kind === 'advance'
            ? strings.stageLock.advanceTitle
            : strings.contents.reopenOf(stageName)}
        </h2>
        <div id="stage-lock-what" className="delete-book-what">
          {preview.isPending && <p>{strings.stageLock.loading}</p>}
          {preview.isError && (
            <p className="new-book-error" role="alert">
              {strings.stageLock.loadFailed}
            </p>
          )}
          {advancePreview.data && <AdvanceWhat preview={advancePreview.data} />}
          {reopenPreview.data && (
            <>
              <p>{strings.stageLock.reopenQuestion(stageName)}</p>
              {reopenPreview.data.plans + reopenPreview.data.chapters > 0 ? (
                <>
                  <p className="delete-book-warning">
                    {strings.stageLock.reopenDeletes(
                      stageName,
                      reopenPreview.data.plans,
                      reopenPreview.data.chapters,
                    )}
                  </p>
                  <p className="delete-book-warning">{strings.stageLock.irreversible}</p>
                </>
              ) : (
                <p>{strings.stageLock.reopenNothing}</p>
              )}
              <p>{strings.stageLock.reopenLater(stageName)}</p>
              <p>{strings.stageLock.snapshot}</p>
            </>
          )}
        </div>
        {titleRequired && (
          <>
            <label htmlFor="stage-lock-input">{strings.deleteBook.confirmLabel}</label>
            <input
              id="stage-lock-input"
              value={typed}
              placeholder={work.title}
              autoComplete="off"
              onChange={(event) => {
                setTyped(event.target.value)
              }}
            />
          </>
        )}
        <p className="new-book-error" role="alert">
          {run.isError ? failure : null}
        </p>
        <div className="new-book-actions">
          <button ref={cancel} type="button" className="paper-button" onClick={onClose}>
            {strings.stageLock.cancel}
          </button>
          <button
            type="button"
            className="paper-button"
            data-danger
            onClick={confirm}
            disabled={!ready || run.isPending}
            aria-busy={run.isPending}
          >
            {run.isPending && <span className="spinner" aria-hidden="true" />}
            {action.kind === 'advance' ? strings.stageLock.start : strings.stageLock.reopen}
          </button>
        </div>
      </form>
    </div>
  )
}

function AdvanceWhat({ preview }: { preview: StageAdvancePreview }) {
  const name = (card: { name: string | null }) => card.name ?? strings.drawer.untitled
  return (
    <>
      <p>{strings.stageLock.advanceQuestion}</p>
      <p>{strings.stageLock.advanceLock}</p>
      {preview.active_episodes > 0 ? (
        <p>{strings.stageLock.activeEpisodes(preview.active_episodes)}</p>
      ) : (
        <p className="stage-lock-warning">{strings.stageLock.noActive}</p>
      )}
      {preview.incomplete.length > 0 && (
        <>
          <p className="stage-lock-warning">
            {strings.stageLock.incompleteHeading(preview.incomplete.length)}
          </p>
          <ul className="stage-lock-cards">
            {preview.incomplete.map((card) => (
              <li key={card.card_id}>
                <span>
                  {strings.drawer.kind[card.type]} {name(card)}
                </span>
                {card.referenced_by.length > 0 && (
                  <span className="stage-lock-refs">
                    {strings.stageLock.referencedBy(card.referenced_by.map(name).join(', '))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
