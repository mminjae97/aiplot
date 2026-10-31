import { strings } from '../strings'
import type { Card, CardOutput } from '../types'
import { display, isEmpty, rows, same, valueOf } from './cardFields'

type Props = {
  card: CardOutput
  /** The card as saved (edit mode): changed fields show the old value struck (§8). */
  saved: Card | null
  /** Card id → name, so references read as names. */
  names: Map<string, string>
  pinned: string[]
  selected: string | null
  onPin: (path: string) => void
  onSelect: (path: string | null) => void
}

/** The generated card, field by field (§8): click a field to see its evidence sentences;
 * no evidence reads as AI 추정, an empty required field as 아직 정해지지 않음. */
export function CardPreview({ card, saved, names, pinned, selected, onPin, onSelect }: Props) {
  const list = rows(card).filter((row) => {
    // In edit mode only what changed is shown (§8), plus what is still missing and what is
    // pinned (so it can be unpinned).
    if (saved === null) return true
    return (
      !same(row.value, valueOf(saved, row.path)) ||
      (row.required && row.empty) ||
      pinned.includes(row.path)
    )
  })
  return (
    <>
      <p className="preview-hint">{strings.preview.evidenceHint}</p>
      <dl className="preview-fields">
        {list.map((row) => {
          const isPinned = pinned.includes(row.path)
          const before = saved === null ? null : valueOf(saved, row.path)
          return (
            <div
              key={row.path}
              className="preview-field"
              data-selected={selected === row.path || undefined}
              data-empty={row.empty || undefined}
            >
              <dt>
                <button
                  type="button"
                  className="preview-name"
                  aria-pressed={selected === row.path}
                  onClick={() => {
                    onSelect(selected === row.path ? null : row.path)
                  }}
                >
                  {row.label}
                </button>
                {row.guessed && <span className="preview-badge">{strings.preview.guessed}</span>}
                <button
                  type="button"
                  className="preview-pin"
                  aria-pressed={isPinned}
                  aria-label={strings.preview.pin(row.label)}
                  title={strings.preview.pin(row.label)}
                  onClick={() => {
                    onPin(row.path)
                  }}
                >
                  {isPinned ? strings.preview.pinned : strings.preview.pinShort}
                </button>
              </dt>
              <dd>
                {saved !== null && !isEmpty(before) && !same(row.value, before) && (
                  <del className="preview-before" aria-label={strings.preview.before}>
                    {display(before, names)}
                  </del>
                )}
                {row.empty ? (
                  <span className="preview-undecided">
                    {row.required ? strings.preview.undecided : '—'}
                  </span>
                ) : (
                  <span className="preview-value">{display(row.value, names)}</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </>
  )
}
