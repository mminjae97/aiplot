import { useQueries } from '@tanstack/react-query'
import { type PointerEvent, useRef, useState } from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import type { DirectionPlan, PlanBeat, PlanScene, Technique } from '../types'
import {
  allowedCards,
  BEAT_DENSITIES,
  BEAT_FOCUSES,
  BEAT_MODES,
  moveItem,
  TENSIONS,
} from './beatEdits'

type Props = {
  plan: DirectionPlan
  scene: PlanScene
  disabled: boolean
  onBeats: (beats: PlanBeat[]) => void
}

/** A scene's beats, edited in place (§9): each change is saved as it is made. Text fields save
 * when left; a blank one goes back to what it was. Beats are reordered by their handles. */
export function BeatList({ plan, scene, disabled, onBeats }: Props) {
  const list = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const { beats } = scene

  const allowed = allowedCards(plan, scene)
  const details = useQueries({
    queries: allowed.map((id) => ({
      queryKey: ['technique', id],
      queryFn: () => api.getTechnique(id),
      staleTime: Infinity,
    })),
  })
  const cardOf = new Map<string, Technique>(
    details.flatMap((detail) => (detail.data ? [[detail.data.id, detail.data] as const] : [])),
  )

  const change = (order: number, patch: Partial<PlanBeat>) => {
    onBeats(beats.map((beat) => (beat.order === order ? { ...beat, ...patch } : beat)))
  }

  /** The insertion point (0..n) a pointer y falls at: before the first row it is above the
   * middle of. */
  const insertionAt = (y: number) => {
    const rows = [...(list.current?.children ?? [])]
    const at = rows.findIndex((row) => {
      const box = row.getBoundingClientRect()
      return y < box.top + box.height / 2
    })
    return at === -1 ? rows.length : at
  }

  const handle = (at: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ from: at, to: at })
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag) setDrag({ ...drag, to: insertionAt(event.clientY) })
    },
    onPointerUp: () => {
      if (!drag) return
      setDrag(null)
      const moved = moveItem(beats, drag.from, drag.to)
      if (moved.some((beat, index) => beat !== beats[index])) onBeats(moved)
    },
    onPointerCancel: () => {
      setDrag(null)
    },
  })

  const dropping = drag && drag.to !== drag.from && drag.to !== drag.from + 1 ? drag.to : null

  return (
    <ol ref={list} className="beat-list" aria-label={strings.direction.beatsTitle}>
      {beats.map((beat, at) => (
        <li
          key={beat.order}
          className="beat-row"
          data-dragging={drag?.from === at ? '' : undefined}
          data-drop={dropping === at ? 'before' : dropping === at + 1 ? 'after' : undefined}
        >
          <div className="beat-head">
            {!disabled && (
              <span
                className="beat-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label={strings.direction.beatHandle(beat.order)}
                {...handle(at)}
              >
                <span aria-hidden="true">⋮⋮</span>
              </span>
            )}
            <span className="beat-order">{strings.direction.beatName(beat.order)}</span>
            <small>{strings.direction.chars(beat.target_chars)}</small>
          </div>
          <textarea
            // Keyed by value: what the server sends back replaces the field.
            key={`summary:${beat.summary}`}
            rows={2}
            defaultValue={beat.summary}
            disabled={disabled}
            aria-label={strings.direction.beatSummary(beat.order)}
            onBlur={(event) => {
              const text = event.target.value.trim()
              if (text === '') event.target.value = beat.summary
              else if (text !== beat.summary) change(beat.order, { summary: text })
            }}
          />
          <div className="beat-fields">
            <label>
              <span>{strings.direction.beatPov}</span>
              <input
                key={`pov:${beat.pov}`}
                defaultValue={beat.pov}
                disabled={disabled}
                onBlur={(event) => {
                  const text = event.target.value.trim()
                  if (text === '') event.target.value = beat.pov
                  else if (text !== beat.pov) change(beat.order, { pov: text })
                }}
              />
            </label>
            <label>
              <span>{strings.direction.beatMode}</span>
              <select
                value={beat.mode}
                disabled={disabled}
                onChange={(event) => {
                  change(beat.order, { mode: event.target.value as PlanBeat['mode'] })
                }}
              >
                {BEAT_MODES.map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{strings.direction.beatFocus}</span>
              <select
                value={beat.focus}
                disabled={disabled}
                onChange={(event) => {
                  change(beat.order, { focus: event.target.value as PlanBeat['focus'] })
                }}
              >
                {BEAT_FOCUSES.map((focus) => (
                  <option key={focus}>{focus}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{strings.direction.beatDensity}</span>
              <select
                value={beat.density}
                disabled={disabled}
                onChange={(event) => {
                  change(beat.order, { density: event.target.value as PlanBeat['density'] })
                }}
              >
                {BEAT_DENSITIES.map((density) => (
                  <option key={density}>{density}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{strings.direction.beatTension}</span>
              <select
                value={beat.tension}
                disabled={disabled}
                onChange={(event) => {
                  change(beat.order, { tension: Number(event.target.value) })
                }}
              >
                {TENSIONS.map((tension) => (
                  <option key={tension}>{tension}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{strings.direction.beatChars}</span>
              <input
                key={`chars:${String(beat.target_chars)}`}
                type="number"
                min={1}
                defaultValue={beat.target_chars}
                disabled={disabled}
                onBlur={(event) => {
                  const chars = Number.parseInt(event.target.value, 10)
                  if (!Number.isInteger(chars) || chars < 1) {
                    event.target.value = String(beat.target_chars)
                  } else if (chars !== beat.target_chars) {
                    change(beat.order, { target_chars: chars })
                  }
                }}
              />
            </label>
          </div>
          <div className="beat-cards" role="group" aria-label={strings.direction.beatCards}>
            {allowed.map((id) => {
              const on = beat.techniques.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  className="beat-card"
                  aria-pressed={on}
                  disabled={disabled}
                  title={cardOf.get(id)?.description}
                  onClick={() => {
                    change(beat.order, {
                      techniques: on
                        ? beat.techniques.filter((item) => item !== id)
                        : [...beat.techniques, id],
                    })
                  }}
                >
                  {cardOf.get(id)?.name ?? id}
                </button>
              )
            })}
          </div>
        </li>
      ))}
    </ol>
  )
}
