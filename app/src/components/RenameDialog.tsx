import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Work } from '../types'

const TITLE_MAX = 100

type Props = {
  work: Work
  onClose: () => void
}

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'TITLE_EMPTY') return strings.newBook.titleEmpty
    if (error.code === 'TITLE_TOO_LONG') return strings.newBook.titleTooLong
  }
  return strings.rename.failed
}

/** 제목 바꾸기 (§12 S0): the same title rules as a new book; the book keeps its place. */
export function RenameDialog({ work, onClose }: Props) {
  const [title, setTitle] = useState(work.title)
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const rename = useMutation({
    mutationFn: (next: string) => api.updateWork(work.id, { title: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works'] }),
  })

  useEffect(() => {
    // The library gives focus back to the book once the dialog is gone.
    input.current?.select()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const clean = title.split(/\s+/).filter(Boolean).join(' ')
  // Checked here too so the common cases never wait on the server.
  const local = clean.length > TITLE_MAX ? strings.newBook.titleTooLong : null
  const message = local ?? (rename.isError ? errorText(rename.error) : null)
  const unchanged = clean === work.title

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rename.isPending || clean === '' || local !== null) return
    if (unchanged) {
      onClose()
      return
    }
    rename.mutate(title, { onSuccess: onClose })
  }

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
        aria-labelledby="rename-title"
        onSubmit={submit}
      >
        <h2 id="rename-title">{strings.rename.title}</h2>
        <label htmlFor="rename-input">{strings.rename.label}</label>
        <input
          id="rename-input"
          ref={input}
          value={title}
          maxLength={TITLE_MAX * 2}
          aria-invalid={message !== null}
          aria-describedby={message ? 'rename-error' : undefined}
          onChange={(event) => {
            setTitle(event.target.value)
            rename.reset()
          }}
        />
        <p className="new-book-error" id="rename-error" role="alert">
          {message}
        </p>
        <div className="new-book-actions">
          <button type="button" className="paper-button" onClick={onClose}>
            {strings.rename.cancel}
          </button>
          <button
            type="submit"
            className="paper-button"
            data-primary
            disabled={clean === '' || local !== null || rename.isPending}
            aria-busy={rename.isPending}
          >
            {rename.isPending && <span className="spinner" aria-hidden="true" />}
            {strings.rename.save}
          </button>
        </div>
      </form>
    </div>
  )
}
