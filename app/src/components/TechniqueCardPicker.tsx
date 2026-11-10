import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import { DEVICES } from '../strings/devices'
import type { PlanRecommendation, PlanScene, Technique } from '../types'
import { isDirectionCandidate, MAX_CHOSEN, pickRefusal } from './directionPicks'
import { EvidencePanel } from './EvidencePanel'

type Props = {
  scene: PlanScene
  disabled: boolean
  /** Keys 1–5 and Enter answer only while no dialog is over the page. */
  keysActive: boolean
  saving: boolean
  hasBeats: boolean
  onConfirm: (techniques: string[]) => void
}

const MAX_RESULTS = 8

function reasonOf(item: PlanRecommendation): string {
  return strings.direction.reason(
    item.devices.map((device) => DEVICES[device].name),
    item.effects,
    item.situations,
  )
}

/** The cards to direct a scene with (§9): the recommended five in rank order, others from the
 * catalog; 1–3 picked, a fourth or a conflicting one refused with the reason. */
export function TechniqueCardPicker({
  scene,
  disabled,
  keysActive,
  saving,
  hasBeats,
  onConfirm,
}: Props) {
  const [draft, setDraft] = useState<string[]>(scene.chosen)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [inspected, setInspected] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const query = search.trim()
  const found = useQuery({
    queryKey: ['techniques', query],
    queryFn: () => api.listTechniques(query),
    enabled: query !== '',
    staleTime: Infinity,
  })
  const ranked = scene.recommended.map((item) => item.technique)
  const added = draft.filter((id) => !ranked.includes(id))
  const results = (found.data?.techniques ?? [])
    .filter((card) => isDirectionCandidate(card) && !ranked.includes(card.id))
    .filter((card) => !draft.includes(card.id))
    .slice(0, MAX_RESULTS)

  // Every card on show, with what the rules and the evidence need.
  const shown = [...new Set([...ranked, ...draft, ...results.map((card) => card.id)])]
  const details = useQueries({
    queries: shown.map((id) => ({
      queryKey: ['technique', id],
      queryFn: () => api.getTechnique(id),
      staleTime: Infinity,
    })),
  })
  const cardOf = new Map<string, Technique>(
    details.flatMap((detail) => (detail.data ? [[detail.data.id, detail.data] as const] : [])),
  )

  const toggle = (id: string) => {
    setInspected(id)
    if (disabled) return
    if (draft.includes(id)) {
      setRefusal(null)
      setDraft(draft.filter((item) => item !== id))
      return
    }
    const chosen = draft.flatMap((item) => cardOf.get(item) ?? [])
    const refused = pickRefusal(draft.length, chosen, cardOf.get(id))
    if (refused?.kind === 'too_many') {
      setRefusal(strings.direction.tooManyCards(MAX_CHOSEN))
    } else if (refused?.kind === 'conflict') {
      setRefusal(strings.direction.conflictCard(refused.name))
    } else {
      setRefusal(null)
      setDraft([...draft, id])
    }
  }

  const canConfirm = !disabled && !saving && draft.length > 0
  const confirm = () => {
    if (canConfirm) onConfirm(draft)
  }

  // Subscribed anew every render: the keys act on the cards shown now.
  useEffect(() => {
    if (!keysActive) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable === true ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        (target instanceof HTMLInputElement && target.type !== 'checkbox')
      if (typing || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Enter' && target?.tagName !== 'BUTTON' && target?.tagName !== 'SUMMARY') {
        event.preventDefault()
        confirm()
      } else if (/^[1-5]$/.test(event.key)) {
        const id = ranked[Number(event.key) - 1]
        if (id !== undefined) toggle(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  })

  const row = (id: string, rank: number | null, reason: string) => (
    <li key={id}>
      <label
        className="pick-row"
        onMouseEnter={() => {
          setInspected(id)
        }}
      >
        <input
          type="checkbox"
          checked={draft.includes(id)}
          disabled={disabled}
          onFocus={() => {
            setInspected(id)
          }}
          onChange={() => {
            toggle(id)
          }}
        />
        <span>
          <span className="pick-name">
            {rank !== null && <span className="pick-rank">{rank}</span>}
            {cardOf.get(id)?.name ?? id}
          </span>
          <small>{reason}</small>
        </span>
      </label>
    </li>
  )

  const shownCard = inspected ?? draft[0] ?? ranked[0] ?? null
  const recommendation = scene.recommended.find((item) => item.technique === shownCard)

  return (
    <div className="direction-picks">
      <section aria-label={strings.direction.picksTitle}>
        <h4>
          {strings.direction.picksTitle}
          <small>{strings.direction.picksCount(draft.length, MAX_CHOSEN)}</small>
        </h4>
        {ranked.length === 0 && <p className="direction-note">{strings.direction.noRecommended}</p>}
        <ol>{scene.recommended.map((item) => row(item.technique, item.rank, reasonOf(item)))}</ol>
        {added.length > 0 && (
          <ul>{added.map((id) => row(id, null, strings.direction.addedReason))}</ul>
        )}
        {refusal && (
          <p className="pick-refusal" role="alert">
            {refusal}
          </p>
        )}
        <div className="pick-actions">
          <button
            type="button"
            className="paper-button"
            data-primary
            disabled={!canConfirm}
            aria-busy={saving}
            onClick={confirm}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            {hasBeats ? strings.direction.redirect : strings.direction.directScene}
          </button>
          <small>{strings.direction.pickKeys}</small>
        </div>
        {!disabled && (
          <div className="pick-search">
            <input
              type="search"
              aria-label={strings.direction.searchLabel}
              placeholder={strings.direction.searchLabel}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
            />
            {found.isSuccess && results.length === 0 && (
              <p className="direction-note">{strings.direction.noResults}</p>
            )}
            {results.length > 0 && (
              <ul>
                {results.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onMouseEnter={() => {
                        setInspected(card.id)
                      }}
                      onClick={() => {
                        toggle(card.id)
                      }}
                    >
                      {card.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <EvidencePanel
        card={shownCard === null ? null : (cardOf.get(shownCard) ?? null)}
        reason={recommendation ? reasonOf(recommendation) : null}
      />
    </div>
  )
}
