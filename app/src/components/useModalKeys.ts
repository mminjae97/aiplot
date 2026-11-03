import { type RefObject, useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

// Open modals, innermost last: only that one answers Esc and Tab.
const stack: object[] = []

/** The focus is nowhere (on the page body): whatever had it went away. */
function focusLost() {
  return document.activeElement === null || document.activeElement === document.body
}

/** Gives the focus to `target()` once it can take it. The page behind a modal may still be
 * inert for a frame or two (the book lifts it after the page says it is free), so it tries
 * again for a few frames, but only while the focus is still nowhere: it never takes the focus
 * from what got it meanwhile (another dialog, a toast). */
export function focusWhenFree(target: () => Element | null | undefined, tries = 5) {
  const attempt = (left: number, first: boolean) => {
    if (!first && !focusLost()) return
    const element = target()
    if (element instanceof HTMLElement && element.isConnected && !element.closest('[inert]')) {
      element.focus()
    } else if (left > 0) {
      requestAnimationFrame(() => {
        attempt(left - 1, false)
      })
    }
  }
  attempt(tries, true)
}

/** A modal's keys (§12 Esc close): Esc closes it and Tab cycles inside `box`. `first` gets the
 * focus once on open (parent re-renders never move it back); on close the focus goes back to
 * where it was if that is still on the page, else to `fallback()` (e.g. a card opened from a
 * link on a page that is gone: its card on this page). */
export function useModalKeys(
  box: RefObject<HTMLElement | null>,
  onClose: () => void,
  first?: RefObject<HTMLElement | null>,
  fallback?: () => HTMLElement | null | undefined,
) {
  const close = useRef(onClose)
  const elsewhere = useRef(fallback)
  // Where the focus was before the modal; kept in a ref so StrictMode's re-run keeps it.
  const before = useRef<Element | null>(null)
  useEffect(() => {
    close.current = onClose
    elsewhere.current = fallback
  }, [onClose, fallback])

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
      focusWhenFree(() =>
        back instanceof HTMLElement && back.isConnected && back !== document.body
          ? back
          : elsewhere.current?.(),
      )
    }
    // Bound once per open modal; the refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
