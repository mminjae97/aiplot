import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Work } from '../types'

const TITLE_MAX = 100

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
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: api.createWork,
    onSuccess: async (work) => {
      await queryClient.invalidateQueries({ queryKey: ['works'] })
      onCreated(work)
    },
  })

  useEffect(() => {
    input.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!create.isPending) create.mutate({ title })
  }
  // Checked here too so the common cases never wait on the server.
  const local =
    title.trim() === ''
      ? null
      : title.trim().length > TITLE_MAX
        ? strings.newBook.titleTooLong
        : null
  const message = local ?? (create.isError ? errorText(create.error) : null)

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
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
            disabled={title.trim() === '' || local !== null || create.isPending}
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
