import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import { useModalKeys } from './useModalKeys'
import type { Card } from '../types'

type ConfirmProps = {
  card: Card
  /** A part's episodes (§7): the dialog asks to move them to another part or delete them. */
  partEpisodes?: { count: number; otherParts: { id: string; name: string }[] }
  onCancel: () => void
  /** The delete went through; it can be undone until `until` (ISO). */
  onDeleted: (until: string) => void
}

/** 삭제 (§8): names the cards that point at this one, then deletes at once. Red, never the
 * default; the toast that follows can undo it for a few seconds. */
export function DeleteCardDialog({ card, partEpisodes, onCancel, onDeleted }: ConfirmProps) {
  const queryClient = useQueryClient()
  const keep = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const asksEpisodes = (partEpisodes?.count ?? 0) > 0
  const firstOther = partEpisodes?.otherParts[0]?.id ?? null
  // A part id to move to, or 'delete'; move is the default whenever there is a part to
  // move to (it keeps the episodes).
  const [episodesTo, setEpisodesTo] = useState<string>(firstOther ?? 'delete')
  const references = useQuery({
    queryKey: ['card', card.id, 'references'],
    queryFn: () => api.cardReferences(card.id),
  })
  // Focus 취소 once on open: the red button is never the default.
  useModalKeys(box, onCancel, keep)

  const remove = async () => {
    setBusy(true)
    setFailed(null)
    try {
      const deleted = await api.deleteCard(
        card.id,
        asksEpisodes ? { episodes: episodesTo === 'delete' ? 'delete' : `move:${episodesTo}` } : {},
      )
      await queryClient.invalidateQueries({ queryKey: ['cards', card.work_id] })
      void queryClient.invalidateQueries({ queryKey: ['relations', card.work_id] })
      void queryClient.invalidateQueries({ queryKey: ['completeness', card.work_id] })
      onDeleted(deleted.restore_until)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : ''
      // The part has episodes the screen did not know of yet: read them again, so the dialog
      // asks where they go.
      if (code === 'PART_HAS_EPISODES') {
        void queryClient.invalidateQueries({ queryKey: ['relations', card.work_id] })
      }
      setFailed(
        code === 'STAGE_LOCKED'
          ? (strings.drawer.errors.STAGE_LOCKED ?? strings.cardDelete.failed)
          : code === 'PART_HAS_EPISODES'
            ? strings.cardDelete.chooseEpisodes
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
          {asksEpisodes && partEpisodes && (
            <fieldset className="card-delete-episodes">
              <legend>{strings.cardDelete.partEpisodes(partEpisodes.count)}</legend>
              {partEpisodes.otherParts.length > 0 && (
                <label>
                  <input
                    type="radio"
                    name="episodes-to"
                    checked={episodesTo !== 'delete'}
                    onChange={() => {
                      setEpisodesTo(firstOther ?? 'delete')
                    }}
                  />
                  {strings.cardDelete.moveEpisodes}{' '}
                  <select
                    aria-label={strings.cardDelete.moveTarget}
                    value={episodesTo === 'delete' ? (firstOther ?? '') : episodesTo}
                    disabled={episodesTo === 'delete'}
                    onChange={(event) => {
                      setEpisodesTo(event.target.value)
                    }}
                  >
                    {partEpisodes.otherParts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label data-danger>
                <input
                  type="radio"
                  name="episodes-to"
                  checked={episodesTo === 'delete'}
                  onChange={() => {
                    setEpisodesTo('delete')
                  }}
                />
                {strings.cardDelete.deleteEpisodes}
              </label>
            </fieldset>
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
      void queryClient.invalidateQueries({ queryKey: ['completeness', card.work_id] })
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
