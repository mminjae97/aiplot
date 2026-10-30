import type { CSSProperties } from 'react'
import { strings } from '../strings'
import type { Work } from '../types'

// Every book is the same size, cover facing out (portrait 1:1.5).
export const COVER_WIDTH = 150
export const COVER_HEIGHT = 225

// Cloth bindings for covers without an illustration: muted, so the brass stays the accent.
const BINDINGS = ['#6e2c28', '#2f4a3a', '#2c3a55', '#6b4f22', '#465156', '#5a3a4f', '#3f3428']

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable per work: the same book keeps its binding on every visit. */
export function bindingOf(id: string): string {
  return BINDINGS[hash(id) % BINDINGS.length] ?? '#3f3428'
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

type Props = {
  work: Work
  // Cover illustration (1:1.5) once works have one; it replaces all cover text.
  cover?: string
  slip: 'left' | 'right'
  newest: boolean
  highlighted: boolean
  onOpen: (work: Work) => void
}

export function BookItem({ work, cover, slip, newest, highlighted, onOpen }: Props) {
  const stage = strings.stage[work.stage]
  const slipId = `slip-${work.id}`
  const style = { '--binding': bindingOf(work.id) } as CSSProperties
  return (
    <div className="book" style={style} data-highlighted={highlighted || undefined}>
      {newest && <span className="book-ribbon" aria-hidden="true" />}
      <button
        type="button"
        className="book-cover"
        aria-label={work.title}
        aria-describedby={slipId}
        data-illustrated={cover ? true : undefined}
        onClick={() => {
          onOpen(work)
        }}
      >
        {cover ? (
          <img className="book-art" src={cover} alt="" />
        ) : (
          <span className="book-face" aria-hidden="true">
            <span className="book-title">{work.title}</span>
            <span className="book-stage">{stage}</span>
          </span>
        )}
      </button>
      <div className="book-slip" id={slipId} role="tooltip" data-side={slip}>
        <p className="book-slip-title">{work.title}</p>
        <p>{strings.library.stageOf(stage)}</p>
        <p>{strings.library.modified(dateFormat.format(new Date(work.updated_at)))}</p>
      </div>
    </div>
  )
}
