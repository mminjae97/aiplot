import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { strings } from '../strings'
import { useModalKeys } from './useModalKeys'

type Props = {
  /** Where the card lay (the grid card or graph node); it grows from there. */
  origin: DOMRect | null
  label: string
  front: ReactNode
  back: ReactNode
  /** Another dialog sits on top (delete): this one takes no input meanwhile. */
  covered?: boolean
  onClose: () => void
}

/** A card picked up from the dex or the graph (§8 S1-1): it grows to the middle of the window
 * and flips (0.3s) to its back. Esc, 닫기 or a click beside it puts it down. */
export function FlipCard({ origin, label, front, back, covered = false, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useModalKeys(box, onClose, close)

  // FLIP: start at the origin's place and size, then let the transition carry it to the
  // middle while the faces turn. Reduced motion makes both instant (styles/dex.css).
  useLayoutEffect(() => {
    const node = card.current
    if (!node) return
    if (origin) {
      const end = node.getBoundingClientRect()
      node.style.transition = 'none'
      node.style.transform = `translate(${String(origin.left - end.left)}px, ${String(origin.top - end.top)}px) scale(${String(origin.width / end.width)}, ${String(origin.height / end.height)})`
      node.getBoundingClientRect() // commit the start before the transition
      node.style.transition = ''
      node.style.transform = ''
    }
    node.dataset.flipped = 'true'
  }, [origin])

  return (
    <div
      className="dialog-backdrop flip-backdrop"
      inert={covered}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={box} className="flip-frame" role="dialog" aria-modal="true" aria-label={label}>
        <div ref={card} className="flip-card">
          <div className="flip-face flip-front" aria-hidden="true">
            {front}
          </div>
          <div className="flip-face flip-back">
            <button ref={close} type="button" className="flip-close" onClick={onClose}>
              {strings.dex.close}
            </button>
            {back}
          </div>
        </div>
      </div>
    </div>
  )
}
