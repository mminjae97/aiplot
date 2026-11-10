import { useRef } from 'react'
import { strings } from '../strings'
import { Overlay } from './Overlay'
import { useModalKeys } from './useModalKeys'

type Props = {
  directed: number
  onCancel: () => void
  onConfirm: () => void
}

/** 계획 다시 만들기 (§5): says what goes; the red button is never the default. */
export function ReplacePlanDialog({ directed, onCancel, onConfirm }: Props) {
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
          aria-labelledby="replace-plan-title"
          aria-describedby="replace-plan-what"
        >
          <h2 id="replace-plan-title">{strings.direction.replaceTitle}</h2>
          <div id="replace-plan-what" className="delete-book-what">
            <p>{strings.direction.replaceWhat(directed)}</p>
            <p className="delete-book-warning">{strings.direction.replaceIrreversible}</p>
          </div>
          <div className="new-book-actions">
            <button ref={cancel} type="button" className="paper-button" onClick={onCancel}>
              {strings.direction.cancel}
            </button>
            <button type="button" className="paper-button" data-danger onClick={onConfirm}>
              {strings.direction.replaceConfirm}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
