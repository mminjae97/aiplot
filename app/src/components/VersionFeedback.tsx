import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import type { BeatVersion, BeatVersionList, FeedbackRating } from '../types'

type Props = {
  beatId: string
  /** The version rated: the current one, the text the reader sees. */
  version: BeatVersion
}

const RATINGS: FeedbackRating[] = ['good', 'bad']

/** 좋음/별로 with a note on the current version (§9, §10: training feedback, kept on the
 * version). Pressing the pressed one again takes it back, its note with it. */
export function VersionFeedback({ beatId, version }: Props) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState(version.feedback_note ?? '')
  const give = useMutation({
    mutationFn: (rating: FeedbackRating | null) =>
      api.giveFeedback(beatId, { version: version.version, rating, note: note.trim() }),
    onSuccess: (stored) => {
      if (stored.feedback === null) setNote('')
      queryClient.setQueryData<BeatVersionList>(['versions', beatId], (old) =>
        old
          ? {
              versions: old.versions.map((item) =>
                item.version === stored.version ? stored : item,
              ),
            }
          : old,
      )
    },
  })
  const rating = version.feedback
  const noteChanged = note.trim() !== (version.feedback_note ?? '')

  return (
    <div
      className="version-feedback"
      role="group"
      aria-label={strings.writing.feedback(version.version)}
    >
      <div className="version-actions">
        {RATINGS.map((value) => (
          <button
            key={value}
            type="button"
            className="paper-button"
            aria-pressed={rating === value}
            title={strings.writing.feedbackHint}
            disabled={give.isPending}
            onClick={() => {
              give.mutate(rating === value ? null : value)
            }}
          >
            {strings.writing.ratings[value]}
          </button>
        ))}
      </div>
      {rating !== null && (
        <form
          className="warning-ignore"
          onSubmit={(event) => {
            event.preventDefault()
            give.mutate(rating)
          }}
        >
          <label>
            {strings.writing.feedbackNote}
            <textarea
              value={note}
              maxLength={500}
              rows={2}
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
          </label>
          <div className="warning-actions">
            <button
              type="submit"
              className="paper-button"
              disabled={give.isPending || !noteChanged}
            >
              {strings.writing.feedbackNoteSave}
            </button>
          </div>
        </form>
      )}
      {give.isError && (
        <p className="writing-failure" role="alert">
          {strings.writing.feedbackFailed}
        </p>
      )}
    </div>
  )
}
