import { strings } from '../strings'
import type { SimilarName } from '../types'

type Props = {
  notes: string
  sentences: string[]
  /** Indexes of sentences the last turn wrote (§8: briefly highlighted). */
  changed: number[]
  questions: string[]
  similarNames: SimilarName[]
  busy: boolean
  /** The notes being edited by hand; null when not editing (owned by the drawer, which
   * keeps Esc and outside clicks from closing over unsaved text). */
  editing: string | null
  saving: boolean
  saveFailed: boolean
  onEdit: (text: string | null) => void
  onSave: (notes: string) => void
  onSameName: (pair: SimilarName) => void
  onDismissName: (pair: SimilarName) => void
}

/** The drawer's source notes (§8): the AI keeps them; the user may edit them too. */
export function SourcePanel({
  notes,
  sentences,
  changed,
  questions,
  similarNames,
  busy,
  editing,
  saving,
  saveFailed,
  onEdit,
  onSave,
  onSameName,
  onDismissName,
}: Props) {
  return (
    <section className="notes" aria-labelledby="notes-title">
      <div className="notes-head">
        <h3 id="notes-title" className="drawer-section-title">
          {strings.drawer.notesTitle}
        </h3>
        {editing === null && (
          <button
            type="button"
            className="paper-button"
            disabled={busy}
            onClick={() => {
              onEdit(notes)
            }}
          >
            {strings.drawer.editNotes}
          </button>
        )}
      </div>
      {editing !== null ? (
        <form
          className="notes-edit"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(editing)
          }}
        >
          <textarea
            aria-label={strings.drawer.editNotesLabel}
            value={editing}
            maxLength={20000}
            onChange={(event) => {
              onEdit(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
              // Esc leaves an untouched editor; it never throws typed text away.
              event.stopPropagation()
              if (editing === notes) onEdit(null)
            }}
          />
          <div className="notes-actions">
            <button
              type="button"
              className="paper-button"
              onClick={() => {
                onEdit(null)
              }}
            >
              {strings.drawer.cancelNotes}
            </button>
            <button type="submit" className="paper-button" data-primary disabled={saving}>
              {strings.drawer.saveNotes}
            </button>
          </div>
        </form>
      ) : sentences.length === 0 ? (
        <p className="notes-empty">{strings.drawer.notesEmpty}</p>
      ) : (
        <ol className="notes-sentences">
          {sentences.map((sentence, index) => {
            const fresh = changed.includes(index)
            return (
              // Index keys: a sentence is its place in the notes (evidence uses the same).
              <li key={`${String(index)}:${sentence}`} data-changed={fresh || undefined}>
                {sentence}
                {fresh && <span className="visually-hidden"> ({strings.drawer.changedLabel})</span>}
              </li>
            )
          })}
        </ol>
      )}
      {saveFailed && (
        <p className="chat-error" role="alert">
          {strings.drawer.notesSaveFailed}
        </p>
      )}
      {similarNames.map((pair) => (
        <div className="notes-name" key={`${pair.mentioned}/${pair.similar_to}`} role="group">
          <p>{strings.drawer.sameName(pair.mentioned, pair.similar_to)}</p>
          <button
            type="button"
            className="paper-button"
            disabled={busy || editing !== null}
            onClick={() => {
              onSameName(pair)
            }}
          >
            {strings.drawer.same}
          </button>
          <button
            type="button"
            className="paper-button"
            onClick={() => {
              onDismissName(pair)
            }}
          >
            {strings.drawer.different}
          </button>
        </div>
      ))}
      {questions.length > 0 && (
        <div className="notes-questions">
          <h4>{strings.drawer.questions}</h4>
          <ul>
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
