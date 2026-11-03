import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Work } from '../types'
import { useModalKeys } from './useModalKeys'
import { TITLE_MAX, cleanTitle, titleTooLong } from './workTitle'

type Props = {
  onClose: () => void
  onCreated: (work: Work) => void
}

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'TITLE_EMPTY') return strings.newBook.titleEmpty
    if (error.code === 'TITLE_TOO_LONG') return strings.newBook.titleTooLong
  }
  return strings.newBook.failed
}

/** "새로 만들기" asks for the title only (§12 S0); the book then opens to its contents. */
export function NewBookDialog({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const box = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: api.createWork,
    // The new book joins the shelf even if the dialog was closed meanwhile.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works'] }),
  })

  // Esc closes, Tab stays inside; the focus goes back to where it was (the "+" book).
  useModalKeys(box, onClose, input)

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (create.isPending) return
    // Per-call callbacks are dropped after unmount: closing before the answer stays closed.
    create.mutate({ title }, { onSuccess: onCreated })
  }
  const clean = cleanTitle(title)
  // Checked here too, by the server's rules, so the common cases never wait on it.
  const local = titleTooLong(clean) ? strings.newBook.titleTooLong : null
  const message = local ?? (create.isError ? errorText(create.error) : null)

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        ref={box}
        className="new-book"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-book-title"
        onSubmit={submit}
      >
        <h2 id="new-book-title">{strings.newBook.title}</h2>
        <label htmlFor="new-book-input">{strings.newBook.label}</label>
        <input
          id="new-book-input"
          ref={input}
          value={title}
          placeholder={strings.newBook.placeholder}
          maxLength={TITLE_MAX * 2}
          aria-invalid={message !== null}
          aria-describedby={message ? 'new-book-error' : undefined}
          onChange={(event) => {
            setTitle(event.target.value)
            create.reset()
          }}
        />
        <p className="new-book-error" id="new-book-error" role="alert">
          {message}
        </p>
        <div className="new-book-actions">
          <button type="button" className="paper-button" onClick={onClose}>
            {strings.newBook.cancel}
          </button>
          <button
            type="submit"
            className="paper-button"
            data-primary
            disabled={clean === '' || local !== null || create.isPending}
            aria-busy={create.isPending}
          >
            {create.isPending && <span className="spinner" aria-hidden="true" />}
            {strings.newBook.create}
          </button>
        </div>
      </form>
    </div>
  )
}
