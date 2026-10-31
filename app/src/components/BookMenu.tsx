import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { strings } from '../strings'
import type { MenuPoint } from './BookItem'

/** Menu items that open a dialog for the book. */
export type BookAction = 'decorate' | 'rename' | 'delete'

type Props = {
  title: string
  at: MenuPoint
  onAction: (action: BookAction) => void
  /** refocus: closed from the keyboard, so focus goes back to the book. */
  onClose: (refocus: boolean) => void
}

// Keeps the menu this far inside the window edges.
const EDGE = 8

/** Right-click menu of a shelf book (§12 S0). Backup arrives in step 9; until then it shows
 * as not ready. */
export function BookMenu({ title, at, onAction, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(at)

  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (!box) return
    setPlace({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - box.width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - box.height - EDGE)),
    })
  }, [at])

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const away = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) onClose(false)
    }
    const close = () => {
      onClose(false)
    }
    window.addEventListener('mousedown', away, true)
    window.addEventListener('contextmenu', away, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    // The user scrolling away closes it; a scroll the focus caused (right-clicking a book half
    // out of view) does not, so it never closes as it opens.
    window.addEventListener('wheel', close, { capture: true, passive: true })
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('contextmenu', away, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close, { capture: true })
    }
  }, [onClose])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const current = items.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      event.preventDefault()
      items[(to + items.length) % items.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(current + 1)
    else if (event.key === 'ArrowUp') move(current - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
    }
  }

  const item = (action: BookAction, label: string) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-danger={action === 'delete' || undefined}
      onClick={() => {
        onClose(false)
        onAction(action)
      }}
    >
      {label}
    </button>
  )
  return (
    <div
      ref={menu}
      className="book-menu"
      role="menu"
      aria-label={strings.bookMenu.label(title)}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
    >
      {item('decorate', strings.bookMenu.decorate)}
      {item('rename', strings.bookMenu.rename)}
      <button type="button" role="menuitem" tabIndex={-1} aria-disabled="true">
        {strings.bookMenu.backup}
        <span className="book-menu-later">{strings.bookMenu.later}</span>
      </button>
      {item('delete', strings.bookMenu.delete)}
    </div>
  )
}
