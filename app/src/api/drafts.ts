import type { Draft, DraftSourceEvent } from '../types'
import { readEvents } from './sse'

export const draftKey = (draftId: string) => ['draft', draftId]

export type TurnHandlers = {
  /** The next piece of the AI's answer. */
  onReply: (text: string) => void
  /** The answer is complete; the AI now folds the turn into the notes. */
  onReplied: () => void
  /** The notes after the turn (§8: changed sentences are highlighted). */
  onSource: (update: DraftSourceEvent) => void
  onError: (code: string, message: string) => void
}

/** One chat turn (POST /drafts/{draftId}/messages): the reply streams, then the notes. */
export async function sendTurn(
  draftId: string,
  body: { text: string; refs: string[] },
  handlers: TurnHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await readEvents(
    `/drafts/${encodeURIComponent(draftId)}/messages`,
    { method: 'POST', body: JSON.stringify(body), signal },
    (event) => {
      const data = event.data as Record<string, unknown>
      if (event.type === 'reply') handlers.onReply(String(data.text))
      else if (event.type === 'replied') handlers.onReplied()
      else if (event.type === 'source') handlers.onSource(event.data as DraftSourceEvent)
      else if (event.type === 'error') handlers.onError(String(data.code), String(data.message))
    },
  )
}

/** The draft as it stands after a source update, before it is fetched again. */
export function withNotes(draft: Draft, update: DraftSourceEvent): Draft {
  return { ...draft, notes: update.notes, sentences: update.sentences }
}
