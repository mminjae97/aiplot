import type { CSSProperties } from 'react'
import { letteringOf } from './bookColor'

/** CSS variables for a book in this colour: the cloth and lettering that reads on it. */
export function bookStyle(color: string): CSSProperties {
  return { '--binding': color, '--lettering': letteringOf(color) } as CSSProperties
}

type Props = {
  title: string
  stage: string
  // An illustration replaces all cover text; the spine still shows.
  image: string | null
}

/** Spine plus 1:1.5 front, inside an element styled with bookStyle(). */
export function BookFront({ title, stage, image }: Props) {
  return (
    <>
      <span className="book-spine" aria-hidden="true" />
      <span className="book-front">
        {image ? (
          <img className="book-art" src={image} alt="" />
        ) : (
          <span className="book-face" aria-hidden="true">
            <span className="book-title">{title}</span>
            <span className="book-stage">{stage}</span>
          </span>
        )}
      </span>
    </>
  )
}
