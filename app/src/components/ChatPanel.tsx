import { useQuery } from '@tanstack/react-query'
import {
  type KeyboardEvent,
  type SubmitEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { api } from '../api/client'
import { strings } from '../strings'
import type { Card, DraftTurn } from '../types'

type Props = {
  workId: string
  turns: DraftTurn[]
  /** The answer still arriving, and the user's words it answers. */
  pending: { user: string; reply: string } | null
  stage: 'idle' | 'replying' | 'organizing'
  /** No sending (e.g. while the notes are edited by hand). */
  locked: boolean
  error: string | null
  onSend: (text: string, refs: string[]) => void
}

// The @ word being typed just before the caret, if any.
const MENTION = /@([^\s@]*)$/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when the message still names the card as a whole @word (not @레오 in @레오나). */
function mentions(message: string, name: string): boolean {
  return new RegExp(`@${escapeRegExp(name)}(?=$|[\\s.,!?…'"’”」』)])`).test(message)
}

function Mentions({
  cards,
  active,
  onPick,
}: {
  cards: Card[]
  active: number
  onPick: (card: Card) => void
}) {
  if (cards.length === 0) return null
  return (
    <ul className="chat-mentions" role="listbox" aria-label={strings.drawer.mentionLabel}>
      {cards.map((card, index) => (
        <li
          key={card.id}
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => {
            // Keeps focus in the input.
            event.preventDefault()
            onPick(card)
          }}
        >
          <span>{card.name}</span>
          <span className="chat-mention-kind">{strings.drawer.kind[card.type]}</span>
        </li>
      ))}
    </ul>
  )
}

/** The drawer's chat (§8): turns, the reply as it streams, @ mentions of other cards. */
export function ChatPanel({ workId, turns, pending, stage, locked, error, onSend }: Props) {
  const [text, setText] = useState('')
  const [refs, setRefs] = useState<{ id: string; name: string }[]>([])
  const [mention, setMention] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLOListElement>(null)
  // After a pick, where the caret goes once the new text is in the textarea.
  const caret = useRef<number | null>(null)
  const busy = stage !== 'idle' || locked
  const found = useQuery({
    queryKey: ['cards', workId, 'mention', mention ?? ''],
    queryFn: () => api.listCards(workId, { q: mention ?? '' }),
    enabled: mention !== null,
    staleTime: 5000,
    // The last list stays while the next word's arrives.
    placeholderData: (previous) => previous,
  })
  const options =
    mention === null ? [] : (found.data?.cards ?? []).filter((card) => card.name).slice(0, 6)

  useEffect(() => {
    // The newest turn stays in view.
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [turns.length, pending?.reply])

  const update = (value: string) => {
    setText(value)
    const caret = input.current?.selectionStart ?? value.length
    const match = MENTION.exec(value.slice(0, caret))
    setMention(match ? (match[1] ?? '') : null)
    setActive(0)
  }

  useLayoutEffect(() => {
    if (caret.current !== null) {
      input.current?.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
  }, [text])

  const pick = (card: Card) => {
    const at = input.current?.selectionStart ?? text.length
    const after = text.slice(at).replace(/^\s+/, '')
    const before = text.slice(0, at).replace(MENTION, `@${card.name ?? ''} `)
    caret.current = before.length
    setText(before + after)
    setRefs((old) => [
      ...old.filter((r) => r.id !== card.id),
      { id: card.id, name: card.name ?? '' },
    ])
    setMention(null)
    input.current?.focus()
  }

  const submit = (event?: SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const message = text.trim()
    if (!message || busy) return
    // Only cards still named in the message count as mentioned.
    onSend(
      message,
      refs.filter((r) => mentions(message, r.name)).map((r) => r.id),
    )
    setText('')
    setRefs([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys that finish a Korean syllable belong to the input method, not to us.
    if (event.nativeEvent.isComposing) {
      if (event.key === 'Escape') event.stopPropagation()
      return
    }
    if (options.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((n) => (n + step + options.length) % options.length)
      return
    }
    const chosen = options[active]
    if (chosen && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      pick(chosen)
      return
    }
    if (mention !== null && event.key === 'Escape') {
      // Closes the list, not the drawer.
      event.stopPropagation()
      setMention(null)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section className="chat" aria-labelledby="chat-title">
      <h3 id="chat-title" className="drawer-section-title">
        {strings.drawer.chatTitle}
      </h3>
      <ol className="chat-log" ref={log} aria-label={strings.drawer.chatLabel} aria-live="polite">
        {turns.map((turn, index) => (
          <li key={index} data-role={turn.role}>
            <span className="chat-who">
              {turn.role === 'user' ? strings.drawer.you : strings.drawer.ai}
            </span>
            <p>{turn.text}</p>
          </li>
        ))}
        {pending && pending.user && (
          <li data-role="user">
            <span className="chat-who">{strings.drawer.you}</span>
            <p>{pending.user}</p>
          </li>
        )}
        {pending && stage === 'replying' && (
          <li data-role="ai" aria-busy="true">
            <span className="chat-who">{strings.drawer.ai}</span>
            <p>
              {pending.reply || <span className="spinner" aria-label={strings.drawer.thinking} />}
            </p>
          </li>
        )}
      </ol>
      {stage === 'organizing' && (
        <p className="chat-status" role="status">
          <span className="spinner" aria-hidden="true" />
          {strings.drawer.organizing}
        </p>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <form className="chat-input" onSubmit={submit}>
        <Mentions cards={options} active={active} onPick={pick} />
        <textarea
          ref={input}
          rows={2}
          value={text}
          aria-label={strings.drawer.inputLabel}
          placeholder={strings.drawer.placeholder}
          maxLength={4000}
          onChange={(event) => {
            update(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="paper-button" data-primary disabled={busy || !text.trim()}>
          {strings.drawer.send}
        </button>
      </form>
    </section>
  )
}
