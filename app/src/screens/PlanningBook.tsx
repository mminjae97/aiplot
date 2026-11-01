import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { bookStyle } from '../components/BookFront'
import { colorOf } from '../components/bookColor'
import { TopBar } from '../components/TopBar'
import { type PlanningScreen, useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import { CharacterDexScreen } from './CharacterDexScreen'
import { ContentsPage } from './ContentsPage'
import {
  canTurn,
  type CarriedNotes,
  type Picture,
  pictureOf,
  playTurn,
  type TurnDirection,
} from './pageTurn'
import { pageOf, pagesOf, samePage, SECTIONS, screenOf, useStorySteps } from './planningPages'
import { RegionMapScreen } from './RegionMapScreen'
import { StoryScreen } from './StoryScreen'
import { WorldBookScreen } from './WorldBookScreen'

/** What every page of the book gets: the screen it shows, a way to turn to another page, and
 * a way to say a drawer or dialog is open (the book then takes no input). */
export type PageProps<S extends PlanningScreen> = {
  screen: S
  turn: (screen: PlanningScreen) => void
  onBusy: (busy: boolean) => void
}

type Props = { screen: PlanningScreen }

/** The open book (§8, §12 S1): the contents and the planning screens are its pages. Post-it
 * notes on its edge open each section; clicking the desk beside it (or PageUp/PageDown)
 * turns one page back or on, the smallest page being a bookmark, a view or a story step. */
export function PlanningBook({ screen }: Props) {
  const { workId } = screen
  const open = useNavigation((store) => store.open)
  const [busy, setBusy] = useState(false)
  const work = useQuery({ queryKey: ['works', workId], queryFn: () => api.getWork(workId) })
  const steps = useStorySteps(workId)
  const pages = pagesOf(steps)
  const page = pageOf(screen, steps)
  const index = pages.findIndex((item) => samePage(item, page))
  const before = index > 0 ? pages[index - 1] : undefined
  const after = index >= 0 && index < pages.length - 1 ? pages[index + 1] : undefined
  // A leaf turns only when the reader turns to another section themselves: a post-it note,
  // the desk beside the book, PageUp/PageDown. Tabs within a section (also turned to from the
  // desk) and links inside the pages change the page in place.
  const bookRef = useRef<HTMLDivElement>(null)
  const pending = useRef<{
    direction: TurnDirection
    before: Picture
    notes: CarriedNotes
  } | null>(null)
  const turnPage = (target: PlanningScreen) => {
    const to = pages.findIndex((item) => samePage(item, pageOf(target, steps)))
    const book = bookRef.current
    const spread = book?.querySelector<HTMLElement>(':scope > .spread')
    const from = SECTIONS.indexOf(screen.name)
    const toSection = SECTIONS.indexOf(target.name)
    if (
      to !== index &&
      to >= 0 &&
      index >= 0 &&
      from !== toSection &&
      book &&
      spread &&
      canTurn()
    ) {
      // The notes of the sections turned past move to the other edge, with the leaf.
      const sections = SECTIONS.slice(Math.min(from, toSection), Math.max(from, toSection))
      pending.current = {
        direction: to > index ? 'next' : 'prev',
        before: pictureOf(spread),
        notes: {
          sections: [...sections],
          before: sections.flatMap((section) => {
            const note = book.querySelector<HTMLElement>(`.book-notes [data-section='${section}']`)
            return note ? [note.cloneNode(true) as HTMLElement] : []
          }),
          levels: new Map(
            [...book.querySelectorAll<HTMLElement>('.book-notes [data-section]')].map((note) => [
              note.dataset.section ?? '',
              Number(getComputedStyle(note).zIndex),
            ]),
          ),
        },
      }
    }
    open(target)
  }
  const screenKey = JSON.stringify(screen)
  useLayoutEffect(() => {
    const turn = pending.current
    pending.current = null
    const book = bookRef.current
    if (!turn || !book) return
    return playTurn(
      book,
      turn.direction,
      turn.before,
      () => {
        const spread = book.querySelector<HTMLElement>(':scope > .spread')
        return spread ? pictureOf(spread) : null
      },
      turn.notes,
    )
  }, [screenKey])

  // Subscribed anew every render (no deps): the keys turn from the page shown now.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while held, with a modifier, or while typing.
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (busy || event.repeat || event.ctrlKey || event.altKey || event.metaKey || typing) return
      if (event.key === 'PageDown' && after) {
        event.preventDefault()
        turnPage(screenOf(after, workId))
      } else if (event.key === 'PageUp' && before) {
        event.preventDefault()
        turnPage(screenOf(before, workId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  })

  const pageProps = { turn: open, onBusy: setBusy }
  const openSection = SECTIONS.indexOf(screen.name)

  return (
    <>
      <TopBar
        onBack={() => {
          open({ name: 'library' })
        }}
        backDisabled={busy}
        title={work.data?.title}
      />
      <main className="desk book-desk" inert={busy}>
        <button
          type="button"
          className="book-turn"
          data-side="prev"
          aria-label={strings.book.prev}
          // aria-disabled, not disabled: the button keeps the focus at the first page.
          aria-disabled={!before}
          onClick={() => {
            if (before) turnPage(screenOf(before, workId))
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div
          ref={bookRef}
          className="book-open"
          style={work.data ? bookStyle(colorOf(work.data)) : undefined}
        >
          {screen.name === 'contents' && <ContentsPage screen={screen} {...pageProps} />}
          {screen.name === 'world' && <WorldBookScreen screen={screen} {...pageProps} />}
          {screen.name === 'characters' && (
            <CharacterDexScreen key={screen.cardId ?? ''} screen={screen} {...pageProps} />
          )}
          {screen.name === 'regions' && (
            <RegionMapScreen key={screen.cardId ?? ''} screen={screen} {...pageProps} />
          )}
          {screen.name === 'story' && <StoryScreen screen={screen} {...pageProps} />}
          {(['left', 'right'] as const).flatMap((side) =>
            [1, 2, 3, 4].map((layer) => (
              <span
                key={`${side}${String(layer)}`}
                className="book-edge"
                data-side={side}
                style={{ '--layer': layer } as CSSProperties}
                aria-hidden="true"
              />
            )),
          )}
          <nav className="book-notes" aria-label={strings.book.sections}>
            {SECTIONS.map((section, at) => (
              <button
                key={section}
                type="button"
                className="book-note"
                data-section={section}
                // Stuck in its section's first page: sections already read stick out on the
                // left, the open one on the right, those still ahead from under the page.
                data-side={at < openSection ? 'past' : at === openSection ? 'open' : 'ahead'}
                // How many pages lie over its own (0 = the open page).
                style={{ '--note': at, '--depth': Math.abs(at - openSection) } as CSSProperties}
                aria-current={screen.name === section ? 'page' : undefined}
                onClick={() => {
                  if (screen.name !== section) turnPage({ name: section, workId })
                }}
              >
                {strings.book.notes[section]}
              </button>
            ))}
          </nav>
        </div>
        <button
          type="button"
          className="book-turn"
          data-side="next"
          aria-label={strings.book.next}
          aria-disabled={!after}
          onClick={() => {
            if (after) turnPage(screenOf(after, workId))
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </main>
    </>
  )
}
