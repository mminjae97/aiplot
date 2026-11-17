import { useRef } from 'react'
import { strings } from '../strings'
import { Overlay } from './Overlay'
import { useModalKeys } from './useModalKeys'
import type { WritingResult } from './writingModel'

type Props = {
  chapterNumber: number
  result: WritingResult
  /** The chapter's characters now, and its target. */
  chars: number
  target: number
  onClose: () => void
}

/** A chapter's job came to its end (§10 S3-1, §12 done → summary modal the user closes): how
 * long it took, what it wrote and the warnings it raised. */
export function CompletionSummary({ chapterNumber, result, chars, target, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useModalKeys(box, onClose, close)
  return (
    <Overlay>
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          ref={box}
          className="new-book completion-summary"
          role="dialog"
          aria-modal="true"
          aria-labelledby="completion-title"
        >
          <h2 id="completion-title">{strings.writing.summaryTitle(chapterNumber)}</h2>
          <dl>
            <dt>{strings.writing.summaryElapsed}</dt>
            <dd>{strings.writing.duration(result.elapsedSec)}</dd>
            <dt>{strings.writing.summaryWritten}</dt>
            <dd>{strings.writing.editChars(result.chars)}</dd>
            <dt>{strings.writing.summaryTotal}</dt>
            <dd>{strings.writing.counter(chars, target)}</dd>
            <dt>{strings.writing.summaryWarnings}</dt>
            <dd>
              {result.warnings === 0
                ? strings.writing.summaryNoWarnings
                : strings.writing.beatWarnings(result.warnings)}
            </dd>
          </dl>
          {result.warnings > 0 && (
            <p className="writing-note">{strings.writing.summaryWarningsHint}</p>
          )}
          <div className="new-book-actions">
            <button ref={close} type="button" className="paper-button" onClick={onClose}>
              {strings.writing.dismiss}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
