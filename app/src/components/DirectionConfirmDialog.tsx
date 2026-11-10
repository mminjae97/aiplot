import { useRef } from 'react'
import { strings } from '../strings'
import { Overlay } from './Overlay'
import { useModalKeys } from './useModalKeys'

type Props = {
  title: string
  what: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

/** Asks before S2 drops what was made (§5): says what goes; the red button is never the
 * default. */
export function DirectionConfirmDialog({ title, what, confirmLabel, onCancel, onConfirm }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useModalKeys(box, onCancel, cancel)
  return (
    <Overlay>
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
          aria-labelledby="direction-confirm-title"
          aria-describedby="direction-confirm-what"
        >
          <h2 id="direction-confirm-title">{title}</h2>
          <div id="direction-confirm-what" className="delete-book-what">
            <p>{what}</p>
            <p className="delete-book-warning">{strings.direction.irreversible}</p>
          </div>
          <div className="new-book-actions">
            <button ref={cancel} type="button" className="paper-button" onClick={onCancel}>
              {strings.direction.cancel}
            </button>
            <button type="button" className="paper-button" data-danger onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
