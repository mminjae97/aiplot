import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useRef, useState } from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import type { Work, WorkList } from '../types'
import { useModalKeys } from './useModalKeys'
import { cleanTitle } from './workTitle'

type Props = {
  work: Work
  onClose: () => void
  onDeleted: () => void
}

/** 작품 삭제 (§12 S0, §5): says what goes with the book, and the red button stays off until the
 * title is typed. Never the default action. */
export function DeleteBookDialog({ work, onClose, onDeleted }: Props) {
  const [typed, setTyped] = useState('')
  const box = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const covers = useQuery({
    queryKey: ['covers', work.id],
    queryFn: () => api.listCovers(work.id),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteWork(work.id),
    // Here, not per call: the shelf updates even if the dialog was closed meanwhile.
    onSuccess: () => {
      // Off the shelf at once, so nothing (focus included) lands on it while it refetches.
      queryClient.setQueryData<WorkList>(['works'], (list) =>
        list ? { works: list.works.filter((w) => w.id !== work.id) } : list,
      )
      queryClient.removeQueries({ queryKey: ['covers', work.id] })
      queryClient.removeQueries({ queryKey: ['cover', work.id] })
      void queryClient.invalidateQueries({ queryKey: ['works'] })
    },
  })

  // Esc closes, Tab stays inside. The library gives focus back once the dialog is gone (to the
  // "+" book after a delete).
  useModalKeys(box, onClose, input)

  // Spacing is forgiven the same way the server cleans titles.
  const matches = cleanTitle(typed) === work.title
  const coverCount = covers.data?.covers.length ?? 0

  const confirm = () => {
    if (!matches || remove.isPending) return
    remove.mutate(undefined, { onSuccess: onDeleted })
  }
  // Enter in the title field never deletes (§5: irreversible is never the default): only a
  // click (or Space/Enter on the red button itself) does.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        ref={box}
        className="new-book delete-book"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-book-title"
        aria-describedby="delete-book-what"
        onSubmit={submit}
      >
        <h2 id="delete-book-title">{strings.deleteBook.title}</h2>
        <div id="delete-book-what" className="delete-book-what">
          <p>{strings.deleteBook.question(work.title)}</p>
          {coverCount > 0 && <p>{strings.deleteBook.covers(coverCount)}</p>}
          <p className="delete-book-warning">{strings.deleteBook.irreversible}</p>
        </div>
        <label htmlFor="delete-book-input">{strings.deleteBook.confirmLabel}</label>
        <input
          id="delete-book-input"
          ref={input}
          value={typed}
          placeholder={work.title}
          autoComplete="off"
          onChange={(event) => {
            setTyped(event.target.value)
          }}
        />
        <p className="new-book-error" role="alert">
          {remove.isError ? strings.deleteBook.failed : null}
        </p>
        <div className="new-book-actions">
          <button type="button" className="paper-button" onClick={onClose}>
            {strings.deleteBook.cancel}
          </button>
          <button
            type="button"
            className="paper-button"
            data-danger
            onClick={confirm}
            disabled={!matches || remove.isPending}
            aria-busy={remove.isPending}
          >
            {remove.isPending && <span className="spinner" aria-hidden="true" />}
            {strings.deleteBook.delete}
          </button>
        </div>
      </form>
    </div>
  )
}
