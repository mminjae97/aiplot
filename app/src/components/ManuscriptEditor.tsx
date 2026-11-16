import { useEffect, useRef } from 'react'
import { strings } from '../strings'
import type { Chapter, ChapterText, Warning } from '../types'
import { liveText, segments, type Streamed } from './writingModel'

type Props = {
  chapter: Chapter
  /** The chapter's stored text; undefined while it loads. */
  text: ChapterText | undefined
  warnings: readonly Warning[]
  streamed: Streamed
  selectedBeat: string | null
  onSelectBeat: (beatId: string) => void
  /** A warning the reader picked in the list: its sentence is brought into view. */
  focused: Warning | null
}

/** The chapter's manuscript (§10 S3-1), read-only until editing comes: each beat's text in
 * order, the beat a job writes streaming in, unchecked beats dimmed until their check is over,
 * warned sentences underlined with a mark in the margin. A beat is picked by its margin number
 * or a click on its text. */
export function ManuscriptEditor({
  chapter,
  text,
  warnings,
  streamed,
  selectedBeat,
  onSelectBeat,
  focused,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const stored = new Map((text?.beats ?? []).map((beat) => [beat.id, beat]))

  useEffect(() => {
    if (!focused) return
    const target = root.current?.querySelector(
      focused.sentence === null
        ? `[data-beat='${focused.beat_id}']`
        : `[data-beat='${focused.beat_id}'] [data-sentence='${String(focused.sentence)}']`,
    )
    target?.scrollIntoView({ block: 'center' })
  }, [focused])

  return (
    <div ref={root} className="manuscript" aria-label={strings.writing.manuscript}>
      {chapter.beats.map((beat) => {
        const saved = stored.get(beat.id)
        const live = liveText(streamed, beat.id, saved?.version ?? null)
        const shown = live ?? saved?.text ?? null
        const own = warnings.filter((w) => w.beat_id === beat.id && w.status === 'open')
        const unchecked = live !== null || saved?.checked === false
        const selected = selectedBeat === beat.id
        return (
          <section
            key={beat.id}
            className="ms-beat"
            data-beat={beat.id}
            data-unchecked={unchecked || undefined}
            data-selected={selected || undefined}
            aria-busy={live !== null && streamed.current === beat.id ? true : undefined}
            aria-label={strings.writing.beat(beat.order)}
            onClick={() => {
              onSelectBeat(beat.id)
            }}
          >
            <button
              type="button"
              className="ms-mark"
              aria-pressed={selected}
              aria-label={strings.writing.selectBeat(beat.order)}
              onClick={(event) => {
                event.stopPropagation()
                onSelectBeat(beat.id)
              }}
            >
              <span>{beat.order}</span>
              {own.length > 0 && (
                <span className="ms-warn-mark" title={strings.writing.beatWarnings(own.length)}>
                  <span aria-hidden="true">⚠</span>
                  {own.length}
                </span>
              )}
              {unchecked && shown !== null && <small>{strings.writing.unchecked}</small>}
            </button>
            {shown === null ? (
              <p className="ms-unwritten">
                <span>{strings.writing.unwritten}</span> {beat.summary}
              </p>
            ) : (
              <div className="ms-text">
                {(live !== null
                  ? [{ text: live, sentence: null, warnings: [] }]
                  : segments(shown, saved?.sentences ?? null, own)
                ).map((piece, at) =>
                  piece.sentence === null ? (
                    <span key={at}>{piece.text}</span>
                  ) : (
                    <span
                      key={at}
                      className="ms-warned"
                      data-sentence={piece.sentence}
                      data-focus={
                        focused?.beat_id === beat.id && focused.sentence === piece.sentence
                          ? ''
                          : undefined
                      }
                      title={piece.warnings.map((w) => strings.writing.kinds[w.kind]).join(', ')}
                    >
                      {piece.text}
                    </span>
                  ),
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
