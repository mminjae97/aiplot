import { useEffect, useRef } from 'react'
import { strings } from '../strings'

type StructureProps = {
  count: 4 | 5
  onKeep: () => void
  onRegenerate: () => void
}

/** Asks before a stage count that needs the card generated again (§7); Esc keeps the card. */
export function StructureConfirm({ count, onKeep, onRegenerate }: StructureProps) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keep.current?.focus()
  }, [])
  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" />
      <div
        className="drawer-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="structure-confirm-title"
        aria-describedby="structure-confirm-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onKeep()
          }
        }}
      >
        <h3 id="structure-confirm-title">{strings.typeSection.regenerateTitle(count)}</h3>
        <p id="structure-confirm-body">{strings.typeSection.regenerateBody}</p>
        <div className="preview-actions">
          <button ref={keep} type="button" className="paper-button" onClick={onKeep}>
            {strings.typeSection.keepCard}
          </button>
          <button type="button" className="paper-button" data-danger onClick={onRegenerate}>
            {strings.typeSection.regenerate}
          </button>
        </div>
      </div>
    </>
  )
}

type CloseProps = {
  /** A generated card not saved yet (else only notes would be lost). */
  hasCard: boolean
  editMode: boolean
  canSave: boolean
  saving: boolean
  onDiscard: () => void
  onKeep: () => void
  onSave: () => void
}

/** Asks before closing a drawer with unsaved work (§8); Esc keeps writing. */
export function CloseConfirm({
  hasCard,
  editMode,
  canSave,
  saving,
  onDiscard,
  onKeep,
  onSave,
}: CloseProps) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keep.current?.focus()
  }, [])
  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" />
      <div
        className="drawer-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="drawer-confirm-title"
        aria-describedby="drawer-confirm-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onKeep()
          }
        }}
      >
        <h3 id="drawer-confirm-title">
          {hasCard ? strings.preview.unsavedTitle : strings.drawer.closeTitle}
        </h3>
        <p id="drawer-confirm-body">
          {hasCard
            ? strings.preview.unsavedBody
            : editMode
              ? strings.drawer.closeBodyEdit
              : strings.drawer.closeBody}
        </p>
        <div className="preview-actions">
          <button type="button" className="paper-button" data-danger onClick={onDiscard}>
            {hasCard ? strings.preview.discard : strings.drawer.closeDiscard}
          </button>
          <button ref={keep} type="button" className="paper-button" onClick={onKeep}>
            {strings.preview.keep}
          </button>
          {hasCard && (
            <button
              type="button"
              className="paper-button"
              data-primary
              disabled={!canSave}
              aria-busy={saving}
              onClick={onSave}
            >
              {saving && <span className="spinner" aria-hidden="true" />}
              {strings.preview.save}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
