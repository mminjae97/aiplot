import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { Chapter, ChapterText, Warning, WarningKind, WarningList } from '../types'
import { sentenceText } from './writingModel'

type Props = {
  chapter: Chapter
  text: ChapterText | undefined
  warnings: readonly Warning[]
  /** Card names by id, for the evidence card. */
  names: ReadonlyMap<string, string>
  /** A job writes into the chapter: no beat is written again meanwhile. */
  busy: boolean
  focused: Warning | null
  onFocus: (warning: Warning) => void
  /** 수정 제안: the warning's beat written again. */
  onSuggest: (beatId: string) => void
}

const KINDS = Object.keys(strings.writing.kinds) as WarningKind[]
const QUOTE_MAX = 80

function reasonOf(warning: Warning): string {
  if (warning.kind === 'banned_phrase') {
    return warning.reason
      ? strings.writing.bannedReason(warning.reason)
      : strings.writing.bannedRegex
  }
  // Its reason is an error code (§10), not words for the reader.
  if (warning.kind === 'check_failed') return strings.writing.checkFailedReason
  return warning.reason
}

/** The chapter's warnings (§10 S3-1), grouped by kind: where, the sentence, why and the
 * evidence card; 수정 제안 writes the beat again, 무시 keeps a reason later checks are told.
 * Ignored ones fold away and can be opened again. */
export function ConsistencyWarning({
  chapter,
  text,
  warnings,
  names,
  busy,
  focused,
  onFocus,
  onSuggest,
}: Props) {
  const queryClient = useQueryClient()
  const [ignoring, setIgnoring] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const order = new Map(chapter.beats.map((beat) => [beat.id, beat.order]))
  const stored = new Map((text?.beats ?? []).map((beat) => [beat.id, beat]))

  const update = useMutation({
    mutationFn: (change: { id: string; status: 'open' | 'ignored'; reason?: string }) =>
      api.updateWarning(change.id, { status: change.status, reason: change.reason }),
    onSuccess: (updated) => {
      setIgnoring(null)
      setReason('')
      queryClient.setQueryData<WarningList>(['warnings', chapter.id], (old) =>
        old ? { warnings: old.warnings.map((w) => (w.id === updated.id ? updated : w)) } : old,
      )
    },
  })
  const failure =
    update.error instanceof ApiRequestError
      ? (strings.writing.errors[update.error.code] ?? strings.writing.updateFailed)
      : update.isError
        ? strings.writing.updateFailed
        : null

  const open = warnings.filter((w) => w.status === 'open')
  const ignored = warnings.filter((w) => w.status === 'ignored')

  const item = (warning: Warning) => {
    const beat = stored.get(warning.beat_id)
    const quote = sentenceText(beat?.text ?? null, beat?.sentences ?? null, warning.sentence)
    const card = warning.card_id === null ? null : (names.get(warning.card_id) ?? null)
    return (
      <li
        key={warning.id}
        className="warning-item"
        data-focus={focused?.id === warning.id || undefined}
      >
        <button
          type="button"
          className="warning-where"
          onClick={() => {
            onFocus(warning)
          }}
        >
          {strings.writing.where(order.get(warning.beat_id) ?? 0, warning.sentence)}
        </button>
        {quote && (
          <blockquote>
            {/* Cut by code points: never half an emoji. */}
            {Array.from(quote).length > QUOTE_MAX
              ? `${Array.from(quote).slice(0, QUOTE_MAX).join('')}…`
              : quote}
          </blockquote>
        )}
        <p>{reasonOf(warning)}</p>
        {card && <small>{strings.writing.evidence(card)}</small>}
        {warning.status === 'ignored' ? (
          <>
            {warning.ignore_reason && (
              <small>{strings.writing.ignoredBecause(warning.ignore_reason)}</small>
            )}
            <div className="warning-actions">
              <button
                type="button"
                className="paper-button"
                disabled={update.isPending}
                onClick={() => {
                  update.mutate({ id: warning.id, status: 'open' })
                }}
              >
                {strings.writing.reopen}
              </button>
            </div>
          </>
        ) : ignoring === warning.id ? (
          <form
            className="warning-ignore"
            onSubmit={(event) => {
              event.preventDefault()
              update.mutate({ id: warning.id, status: 'ignored', reason: reason.trim() })
            }}
          >
            <label>
              {strings.writing.ignoreReason}
              <textarea
                value={reason}
                maxLength={500}
                rows={2}
                // The form opens on 무시: its field takes the focus the button had.
                autoFocus
                onChange={(event) => {
                  setReason(event.target.value)
                }}
              />
            </label>
            <div className="warning-actions">
              <button type="submit" className="paper-button" disabled={update.isPending}>
                {strings.writing.ignoreConfirm}
              </button>
              <button
                type="button"
                className="paper-button"
                onClick={() => {
                  setIgnoring(null)
                  setReason('')
                }}
              >
                {strings.writing.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className="warning-actions">
            <button
              type="button"
              className="paper-button"
              disabled={busy}
              title={strings.writing.suggestHint}
              onClick={() => {
                onSuggest(warning.beat_id)
              }}
            >
              {strings.writing.suggest}
            </button>
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                update.reset()
                setReason('')
                setIgnoring(warning.id)
              }}
            >
              {strings.writing.ignore}
            </button>
          </div>
        )}
      </li>
    )
  }

  return (
    <aside className="warnings" aria-label={strings.writing.warningsTitle}>
      <h3>
        {strings.writing.warningsTitle} <small>{open.length}</small>
      </h3>
      {failure && (
        <p className="writing-failure" role="alert">
          {failure}
        </p>
      )}
      {open.length === 0 && <p className="writing-note">{strings.writing.noWarnings}</p>}
      {KINDS.map((kind) => {
        const ofKind = open.filter((w) => w.kind === kind)
        if (ofKind.length === 0) return null
        return (
          <section key={kind} className="warning-group">
            <h4>
              {strings.writing.kinds[kind]} <small>{ofKind.length}</small>
            </h4>
            <ul>{ofKind.map(item)}</ul>
          </section>
        )
      })}
      {ignored.length > 0 && (
        <details className="warning-ignored">
          <summary>{strings.writing.ignored(ignored.length)}</summary>
          <ul>{ignored.map(item)}</ul>
        </details>
      )}
    </aside>
  )
}
