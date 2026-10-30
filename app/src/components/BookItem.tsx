import type { CSSProperties } from 'react'
import { strings } from '../strings'
import type { Work } from '../types'

// Cloth bindings: muted, so the brass lettering stays the only accent on the shelf.
const BINDINGS = ['#6e2c28', '#2f4a3a', '#2c3a55', '#6b4f22', '#465156', '#5a3a4f', '#3f3428']

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable per work: the same book keeps its colour and size on every visit. */
export function spineOf(id: string): { width: number; height: number; binding: string } {
  const h = hash(id)
  return {
    width: 46 + (h % 17),
    height: 206 + ((h >>> 5) % 44),
    binding: BINDINGS[(h >>> 11) % BINDINGS.length] ?? '#3f3428',
  }
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

type Props = {
  work: Work
  slip: 'left' | 'right'
  newest: boolean
  highlighted: boolean
  onOpen: (work: Work) => void
}

export function BookItem({ work, slip, newest, highlighted, onOpen }: Props) {
  const spine = spineOf(work.id)
  const stage = strings.stage[work.stage]
  const slipId = `slip-${work.id}`
  const style = {
    '--spine-width': `${String(spine.width)}px`,
    '--spine-height': `${String(spine.height)}px`,
    '--binding': spine.binding,
  } as CSSProperties
  return (
    <div className="book" style={style} data-highlighted={highlighted || undefined}>
      {newest && <span className="book-ribbon" aria-hidden="true" />}
      <button
        type="button"
        className="book-spine"
        aria-describedby={slipId}
        onClick={() => {
          onOpen(work)
        }}
      >
        <span className="book-title">{work.title}</span>
        <span className="book-stage">{stage}</span>
      </button>
      <div className="book-slip" id={slipId} role="tooltip" data-side={slip}>
        <p className="book-slip-title">{work.title}</p>
        <p>{strings.library.stageOf(stage)}</p>
        <p>{strings.library.modified(dateFormat.format(new Date(work.updated_at)))}</p>
      </div>
    </div>
  )
}
