import { useEffect, useState } from 'react'
import { focusWhenFree } from './useModalKeys'

/** How long a card just saved or brought back stays highlighted (§8). */
export const ARRIVAL_MS = 300

/** The card just saved or brought back (§8 "After save: close, highlight card 0.3s"): set it
 * with `arrive(id)`; the 0.3s start once `shown(id)` says it is on the page (a save refetches
 * the list first). With nothing focused then (the drawer or toast gone), the focus goes to
 * `target(id)`. The motion itself is CSS, which respects reduced motion. */
export function useArrival(
  shown: (id: string) => boolean,
  target: (id: string) => HTMLElement | null | undefined,
): [string | null, (id: string) => void] {
  const [arrived, setArrived] = useState<string | null>(null)
  const visible = arrived !== null && shown(arrived)
  useEffect(() => {
    if (arrived === null || !visible) return
    if (document.activeElement === null || document.activeElement === document.body) {
      focusWhenFree(() => target(arrived))
    }
    const timer = window.setTimeout(() => {
      setArrived(null)
    }, ARRIVAL_MS)
    return () => {
      window.clearTimeout(timer)
    }
    // target is read once, when the card shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, visible])
  return [visible ? arrived : null, setArrived]
}
