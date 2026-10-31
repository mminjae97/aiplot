import { type RefObject, useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

// Open modals, innermost last: only that one answers Esc and Tab.
const stack: object[] = []

/** A modal's keys (§12 Esc close): Esc closes it and Tab cycles inside `box`. `first` gets the
 * focus once on open (parent re-renders never move it back); on close the focus goes back to
 * where it was, if that is still on the page. */
export function useModalKeys(
  box: RefObject<HTMLElement | null>,
  onClose: () => void,
  first?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose)
  // Where the focus was before the modal; kept in a ref so StrictMode's re-run keeps it.
  const before = useRef<Element | null>(null)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  useEffect(() => {
    const token = {}
    before.current ??= document.activeElement
    stack.push(token)
    ;(first?.current ?? box.current)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      } else if (event.key === 'Tab') {
        const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        const head = items[0]
        const tail = items[items.length - 1]
        if (head === undefined || tail === undefined) return
        const inside = box.current?.contains(document.activeElement) ?? false
        if (event.shiftKey && (!inside || document.activeElement === head)) {
          event.preventDefault()
          tail.focus()
        } else if (!event.shiftKey && (!inside || document.activeElement === tail)) {
          event.preventDefault()
          head.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      const back = before.current
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
    // Bound once per open modal; the refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
