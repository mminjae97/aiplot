import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { UndoRedo } from '@tiptap/extensions'
import type { Node as DocNode } from '@tiptap/pm/model'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import { useState } from 'react'
import { strings } from '../strings'
import { countChars, MAX_BEAT_CHARS } from './writingModel'

/** A beat's text as the editor holds it: one paragraph per line, blank lines kept. */
function toDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((line) =>
        line === ''
          ? { type: 'paragraph' }
          : { type: 'paragraph', content: [{ type: 'text', text: line }] },
      ),
  }
}

/** The editor's paragraphs back as lines. */
function toText(doc: DocNode): string {
  const lines: string[] = []
  doc.forEach((node) => {
    lines.push(node.textContent)
  })
  return lines.join('\n')
}

type Props = {
  order: number
  /** The beat's current text ('' for a beat not written yet: it may be written by hand). */
  text: string
  saving: boolean
  /** Why the last save failed. */
  error: string | null
  onSave: (text: string) => void
  onCancel: () => void
  /** Called as the text comes to differ from the saved one, or back. */
  onDirty: (dirty: boolean) => void
}

/** One beat's text in TipTap (§2, §10 S3-1): plain paragraphs, no marks; saved as the beat's
 * next version. Unsaved text lives only here (§6: never persisted). */
export function BeatEditor({ order, text, saving, error, onSave, onCancel, onDirty }: Props) {
  const [current, setCurrent] = useState(text)
  const [asking, setAsking] = useState(false)
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, UndoRedo],
    content: toDoc(text),
    autofocus: 'end',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'ms-text ms-editing',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': strings.writing.editLabel(order),
      },
    },
    onUpdate: ({ editor: changed }) => {
      const next = toText(changed.state.doc)
      setCurrent(next)
      setAsking(false)
      onDirty(next !== text)
    },
  })

  const chars = countChars(current)
  const blank = current.trim() === ''
  const tooLong = chars > MAX_BEAT_CHARS
  const dirty = current !== text
  const savable = !blank && !tooLong
  // Said once there is something to say: a beat not written yet opens blank.
  const problem = tooLong
    ? strings.writing.editTooLong(MAX_BEAT_CHARS)
    : blank && dirty
      ? strings.writing.editEmpty
      : null
  const save = () => {
    if (!saving && savable) onSave(current)
  }
  const cancel = () => {
    if (dirty) setAsking(true)
    else onCancel()
  }

  return (
    <div
      className="beat-editor"
      onKeyDown={(event) => {
        if (event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'KeyS') {
          event.preventDefault()
          save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          if (asking) {
            setAsking(false)
            editor.commands.focus()
          } else cancel()
        }
      }}
    >
      <EditorContent editor={editor} />
      <div className="beat-editor-bar">
        <small className="beat-editor-count" aria-live="polite">
          {strings.writing.editChars(chars)}
        </small>
        <small>{strings.writing.editKeys}</small>
      </div>
      {(problem !== null || error !== null) && (
        <p className="writing-failure" role="alert">
          {problem ?? error}
        </p>
      )}
      {asking ? (
        <div className="beat-editor-actions" role="group" aria-label={strings.writing.discardAsk}>
          <p>{strings.writing.discardAsk}</p>
          <button
            type="button"
            className="paper-button"
            autoFocus
            onClick={() => {
              setAsking(false)
              editor.commands.focus()
            }}
          >
            {strings.writing.keepEditing}
          </button>
          <button type="button" className="paper-button" data-danger="" onClick={onCancel}>
            {strings.writing.discard}
          </button>
        </div>
      ) : (
        <div className="beat-editor-actions">
          <button
            type="button"
            className="paper-button"
            data-primary=""
            disabled={saving || !savable}
            aria-keyshortcuts="Control+S"
            onClick={save}
          >
            {saving ? strings.writing.saving : strings.writing.save}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={saving}
            aria-keyshortcuts="Escape"
            onClick={cancel}
          >
            {strings.writing.cancel}
          </button>
        </div>
      )}
    </div>
  )
}
