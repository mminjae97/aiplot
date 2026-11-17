import { type ReactNode, useEffect, useRef } from 'react'
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
  /** Beats a recheck job checks again (after a save or a restore). */
  rechecking: ReadonlySet<string>
  /** The beat being edited, shown as `editor` in place of its text. */
  editing: string | null
  editor: ReactNode
  /** A double click on a beat edits it, when it may be edited now. */
  onEditBeat: ((beatId: string) => void) | null
}

/** The chapter's manuscript (§10 S3-1): each beat's text in order, the beat a job writes
 * streaming in, unchecked beats dimmed until their check is over, warned sentences underlined
 * with a mark in the margin. A beat is picked by its margin number or a click on its text, and
 * edited one at a time in TipTap (a double click, or the toolbar). */
export function ManuscriptEditor({
  chapter,
  text,
  warnings,
  streamed,
  selectedBeat,
  onSelectBeat,
  focused,
  rechecking,
  editing,
  editor,
  onEditBeat,
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
    <div ref={root} className="manuscript" role="region" aria-label={strings.writing.manuscript}>
      {chapter.beats.map((beat) => {
        const saved = stored.get(beat.id)
        const live = liveText(streamed, beat.id, saved?.version ?? null)
        const shown = live ?? saved?.text ?? null
        const own = warnings.filter((w) => w.beat_id === beat.id && w.status === 'open')
        // Checked by the job now, or left unchecked by one that stopped (§10: until the beat
        // is written again).
        const checking =
          live !== null || streamed.checking.includes(beat.id) || rechecking.has(beat.id)
        const unchecked = checking || saved?.checked === false
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
            onDoubleClick={() => {
              if (onEditBeat && beat.id !== editing && live === null) onEditBeat(beat.id)
            }}
          >
            <button
              type="button"
              className="ms-mark"
              aria-pressed={selected}
              onClick={(event) => {
                event.stopPropagation()
                onSelectBeat(beat.id)
              }}
            >
              {/* Named by its content: the number, its warnings and its check (§5: never by
                  colour alone). */}
              <span className="visually-hidden">{strings.writing.selectBeat(beat.order)}</span>
              <span aria-hidden="true">{beat.order}</span>
              {own.length > 0 && (
                <span className="ms-warn-mark">
                  <span aria-hidden="true">⚠{own.length}</span>
                  <span className="visually-hidden">
                    , {strings.writing.beatWarnings(own.length)}
                  </span>
                </span>
              )}
              {unchecked && shown !== null && (
                <small title={checking ? undefined : strings.writing.notCheckedHint}>
                  <span className="visually-hidden">, </span>
                  {checking ? strings.writing.unchecked : strings.writing.notChecked}
                </small>
              )}
            </button>
            {beat.id === editing ? (
              editor
            ) : shown === null ? (
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
