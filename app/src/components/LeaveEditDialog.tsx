import { useRef } from 'react'
import { strings } from '../strings'
import { Overlay } from './Overlay'
import { useModalKeys } from './useModalKeys'

type Props = {
  onStay: () => void
  onLeave: () => void
}

/** Asks before the writing page leaves a beat's edits not saved yet (another chapter, a page
 * turn, the library): they live only in the editor (§6) and would be lost. Staying is the
 * default; dropping them is red (§5). */
export function LeaveEditDialog({ onStay, onLeave }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const stay = useRef<HTMLButtonElement>(null)
  useModalKeys(box, onStay, stay)
  return (
    <Overlay>
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onStay()
        }}
      >
        <div
          ref={box}
          className="new-book delete-book"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="leave-edit-title"
          aria-describedby="leave-edit-what"
        >
          <h2 id="leave-edit-title">{strings.writing.leaveTitle}</h2>
          <p id="leave-edit-what">{strings.writing.leaveWhat}</p>
          <div className="new-book-actions">
            <button ref={stay} type="button" className="paper-button" onClick={onStay}>
              {strings.writing.keepEditing}
            </button>
            <button type="button" className="paper-button" data-danger onClick={onLeave}>
              {strings.writing.leaveDrop}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
