import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiRequestError, api } from '../api/client'
import { strings } from '../strings'
import type { BeatSaved, ChapterBeat } from '../types'
import { elide, textDiff } from './textDiff'
import { VersionFeedback } from './VersionFeedback'

type Props = {
  /** The picked beat, null while none is. */
  beat: ChapterBeat | null
  /** Its text may not be put back now: a job writes the chapter, or the beat is being edited. */
  busy: boolean
  onRestored: (beatId: string, saved: BeatSaved) => void
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/** The picked beat's versions (§10 S3-1: edits create versions; compare, restore), newest
 * first: an earlier one compared word by word with the current one, or put back as the next
 * version (which is then checked again). */
export function VersionHistory({ beat, busy, onRestored }: Props) {
  const [comparing, setComparing] = useState<number | null>(null)
  const beatId = beat?.id ?? null
  const written = beat !== null && beat.version !== null
  const versions = useQuery({
    queryKey: ['versions', beatId],
    queryFn: () => api.beatVersions(beatId ?? ''),
    enabled: written,
  })
  const restore = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.restoreVersion(id, version),
    onSuccess: (saved, { id }) => {
      setComparing(null)
      onRestored(id, saved)
    },
  })

  const list = versions.data?.versions ?? []
  const current = list[list.length - 1]
  const restoreError =
    restore.error instanceof ApiRequestError
      ? (strings.writing.errors[restore.error.code] ?? strings.writing.restoreFailed)
      : restore.error
        ? strings.writing.restoreFailed
        : null

  return (
    <section className="versions" aria-labelledby="versions-title">
      <h3 id="versions-title">
        {strings.writing.versions}
        {beat && <small> {strings.writing.versionsOf(beat.order)}</small>}
      </h3>
      {beat === null && <p className="writing-note">{strings.writing.versionsPick}</p>}
      {beat !== null && !written && <p className="writing-note">{strings.writing.versionsNone}</p>}
      {written && versions.isError && (
        <div className="writing-failure" role="alert">
          <p>{strings.writing.versionsLoadFailed}</p>
          <button
            type="button"
            className="paper-button"
            onClick={() => {
              void versions.refetch()
            }}
          >
            {strings.writing.retry}
          </button>
        </div>
      )}
      {restoreError && (
        <p className="writing-failure" role="alert">
          {restoreError}
        </p>
      )}
      {written && current && (
        <ol className="version-list" reversed>
          {[...list].reverse().map((item) => {
            const isCurrent = item.version === current.version
            const name = strings.writing.versionName(item.version)
            const open = comparing === item.version
            return (
              <li key={item.version} className="version" data-current={isCurrent || undefined}>
                <p>
                  <strong>{name}</strong>
                  {isCurrent && <span className="version-current">{strings.writing.current}</span>}
                  <small>{strings.writing.origins[item.origin] ?? item.origin}</small>
                </p>
                <small>
                  {strings.writing.versionMeta(item.chars, when(item.created_at))}
                  {!item.checked && ` · ${strings.writing.notChecked}`}
                  {!isCurrent &&
                    item.feedback !== null &&
                    ` · ${strings.writing.ratings[item.feedback] ?? item.feedback}`}
                </small>
                {!isCurrent && item.feedback_note !== null && (
                  <small className="version-note">{item.feedback_note}</small>
                )}
                {isCurrent && beatId !== null && (
                  <VersionFeedback
                    key={`${beatId}:${String(item.version)}`}
                    beatId={beatId}
                    version={item}
                  />
                )}
                {!isCurrent && (
                  <div className="version-actions">
                    <button
                      type="button"
                      className="paper-button"
                      aria-label={`${name} ${open ? strings.writing.compareClose : strings.writing.compare}`}
                      aria-expanded={open}
                      onClick={() => {
                        setComparing(open ? null : item.version)
                      }}
                    >
                      {open ? strings.writing.compareClose : strings.writing.compare}
                    </button>
                    <button
                      type="button"
                      className="paper-button"
                      aria-label={`${name} ${strings.writing.restore}`}
                      title={strings.writing.restoreHint}
                      disabled={busy || restore.isPending || beatId === null}
                      onClick={() => {
                        if (beatId !== null) restore.mutate({ id: beatId, version: item.version })
                      }}
                    >
                      {strings.writing.restore}
                    </button>
                  </div>
                )}
                {open && (
                  <VersionDiff
                    title={strings.writing.compareTitle(item.version, current.version)}
                    before={item.text}
                    after={current.text}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/** An earlier text against the current one: dropped words struck through, added ones
 * underlined (§5: not by colour alone; del/ins also tell screen readers). */
function VersionDiff({ title, before, after }: { title: string; before: string; after: string }) {
  const pieces = textDiff(before, after)
  const changed = pieces.some((piece) => piece.kind !== 'same')
  return (
    <figure className="version-diff">
      <figcaption>
        {title}
        {changed && (
          <span className="version-legend">
            <del>{strings.writing.removed}</del> <ins>{strings.writing.added}</ins>
          </span>
        )}
      </figcaption>
      {changed ? (
        <div className="version-diff-text">
          {elide(pieces).map((piece, at) =>
            piece.kind === 'removed' ? (
              <del key={at}>{piece.text}</del>
            ) : piece.kind === 'added' ? (
              <ins key={at}>{piece.text}</ins>
            ) : (
              <span key={at}>{piece.text}</span>
            ),
          )}
        </div>
      ) : (
        <p className="writing-note">{strings.writing.same}</p>
      )}
    </figure>
  )
}
