import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Drawers and dialogs of a book page: drawn over the window, outside the book, which takes
 * no input while they are open. */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
