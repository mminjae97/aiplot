import { useCallback, useEffect, useRef, useState } from 'react'
import { focusWhenFree } from './useModalKeys'

/** How long a card just saved or brought back stays highlighted (§8). */
export const ARRIVAL_MS = 300

/** How long an arrival waits for its card to show before it lapses (e.g. brought back while
 * another step is open): a late one would flash and take the focus out of nowhere. */
export const ARRIVAL_WAIT_MS = 1500

/** The card just saved or brought back (§8 "After save: close, highlight card 0.3s"): set it
 * with `arrive(id)`; the 0.3s start once `shown(id)` says it is on the page (a save refetches
 * the list first). Not on the page ARRIVAL_WAIT_MS after `arrive`, it lapses unseen. With
 * nothing focused when it shows (the drawer or toast gone), the focus goes to `target(id)`.
 * The motion itself is CSS, which respects reduced motion. */
export function useArrival(
  shown: (id: string) => boolean,
  target: (id: string) => HTMLElement | null | undefined,
): [string | null, (id: string) => void] {
  // n tells two arrivals of the same card apart, so the second waits afresh.
  const [arrival, setArrival] = useState<{ id: string; n: number } | null>(null)
  const count = useRef(0)
  const arrived = arrival?.id ?? null
  const visible = arrived !== null && shown(arrived)
  const visibleNow = useRef(visible)
  useEffect(() => {
    visibleNow.current = visible
  }, [visible])

  useEffect(() => {
    if (arrival === null) return
    const timer = window.setTimeout(() => {
      // One showing now ends with its own highlight.
      if (!visibleNow.current) setArrival(null)
    }, ARRIVAL_WAIT_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [arrival])

  useEffect(() => {
    if (arrived === null || !visible) return
    if (document.activeElement === null || document.activeElement === document.body) {
      focusWhenFree(() => target(arrived))
    }
    const timer = window.setTimeout(() => {
      setArrival(null)
    }, ARRIVAL_MS)
    return () => {
      window.clearTimeout(timer)
    }
    // target is read once, when the card shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival, visible])

  const arrive = useCallback((id: string) => {
    count.current += 1
    setArrival({ id, n: count.current })
  }, [])
  return [visible ? arrived : null, arrive]
}
