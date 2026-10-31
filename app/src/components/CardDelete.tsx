import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Card } from '../types'

type ConfirmProps = {
  card: Card
  onCancel: () => void
  /** The delete went through; it can be undone until `until` (ISO). */
  onDeleted: (until: string) => void
}

/** 삭제 (§8): names the cards that point at this one, then deletes at once. Red, never the
 * default; the toast that follows can undo it for a few seconds. */
export function DeleteCardDialog({ card, onCancel, onDeleted }: ConfirmProps) {
  const queryClient = useQueryClient()
  const keep = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  }, [onCancel])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const references = useQuery({
    queryKey: ['card', card.id, 'references'],
    queryFn: () => api.cardReferences(card.id),
  })

  // Focus 취소 once on open; parent re-renders (refetches) must not move it back.
  useEffect(() => {
    keep.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel.current()
      else if (event.key === 'Tab') {
        // Modal: Tab cycles inside the dialog.
        const buttons = [...(box.current?.querySelectorAll('button:not(:disabled)') ?? [])]
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return
        const inside = box.current?.contains(document.activeElement) ?? false
        if (event.shiftKey && (!inside || document.activeElement === first)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const remove = async () => {
    setBusy(true)
    setFailed(null)
    try {
      const deleted = await api.deleteCard(card.id)
      await queryClient.invalidateQueries({ queryKey: ['cards', card.work_id] })
      void queryClient.invalidateQueries({ queryKey: ['relations', card.work_id] })
      onDeleted(deleted.restore_until)
    } catch (err) {
      setFailed(
        err instanceof ApiRequestError && err.code === 'STAGE_LOCKED'
          ? (strings.drawer.errors.STAGE_LOCKED ?? strings.cardDelete.failed)
          : strings.cardDelete.failed,
      )
      setBusy(false)
    }
  }

  const refs = references.data?.references ?? []
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={box}
        className="new-book delete-book"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="card-delete-title"
        aria-describedby="card-delete-what"
      >
        <h2 id="card-delete-title">
          {strings.cardDelete.title(card.name ?? strings.drawer.untitled)}
        </h2>
        <div id="card-delete-what" className="delete-book-what">
          {refs.length > 0 ? (
            <>
              <p>{strings.cardDelete.referenced}</p>
              <ul className="card-delete-refs">
                {refs.map((ref) => (
                  <li key={`${ref.card_id}:${ref.field}`}>
                    {ref.name ?? strings.drawer.untitled}
                    <span className="chat-mention-kind"> {strings.drawer.kind[ref.type]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{strings.cardDelete.unreferenced}</p>
          )}
          <p>{strings.cardDelete.undoNote}</p>
        </div>
        <p className="new-book-error" role="alert">
          {failed}
        </p>
        <div className="new-book-actions">
          <button ref={keep} type="button" className="paper-button" onClick={onCancel}>
            {strings.cardDelete.cancel}
          </button>
          <button
            type="button"
            className="paper-button"
            data-danger
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void remove()
            }}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {strings.cardDelete.delete}
          </button>
        </div>
      </div>
    </div>
  )
}

type ToastProps = {
  card: Card
  until: string
  onDone: () => void
  /** The card is back. */
  onRestored: (card: Card) => void
}

/** 되돌리기 (§8): a toast for the few seconds the server keeps a deleted card. */
export function UndoToast({ card, until, onDone, onRestored }: ToastProps) {
  const queryClient = useQueryClient()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const undo = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    undo.current?.focus()
  }, [])

  useEffect(() => {
    const left = Math.max(0, new Date(until).getTime() - Date.now())
    const timer = window.setTimeout(onDone, left)
    return () => {
      window.clearTimeout(timer)
    }
  }, [until, onDone])

  const restore = async () => {
    setBusy(true)
    try {
      const back = await api.restoreCard(card.id)
      await queryClient.invalidateQueries({ queryKey: ['cards', card.work_id] })
      void queryClient.invalidateQueries({ queryKey: ['relations', card.work_id] })
      onRestored(back)
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="undo-toast" role="status">
      <p>
        {failed
          ? strings.cardDelete.restoreFailed
          : strings.cardDelete.deleted(card.name ?? strings.drawer.untitled)}
      </p>
      {!failed && (
        <button
          ref={undo}
          type="button"
          className="paper-button"
          disabled={busy}
          onClick={() => {
            void restore()
          }}
        >
          {strings.cardDelete.undo}
        </button>
      )}
    </div>
  )
}
