import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { bookStyle } from '../components/BookFront'
import { colorOf } from '../components/bookColor'
import { TopBar } from '../components/TopBar'
import { type PlanningScreen, useNavigation } from '../stores/navigation'
import { strings } from '../strings'
import { CharacterDexScreen } from './CharacterDexScreen'
import { ContentsPage } from './ContentsPage'
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
  const pageKey = JSON.stringify(page)

  // A turning leaf plays whenever the page changes, forward or back by the reading order.
  const [shown, setShown] = useState<{ key: string; index: number; dir: 'next' | 'prev' | null }>({
    key: pageKey,
    index,
    dir: null,
  })
  if (shown.key !== pageKey) {
    setShown({ key: pageKey, index, dir: index >= shown.index ? 'next' : 'prev' })
  }

  const turnTo = (target: PlanningScreen) => {
    open(target)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy) return
      if (event.key === 'PageDown' && after) {
        event.preventDefault()
        open(screenOf(after, workId))
      } else if (event.key === 'PageUp' && before) {
        event.preventDefault()
        open(screenOf(before, workId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [busy, after, before, open, workId])

  const pageProps = { turn: turnTo, onBusy: setBusy }

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
          disabled={!before}
          onClick={() => {
            if (before) open(screenOf(before, workId))
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div className="book-open" style={work.data ? bookStyle(colorOf(work.data)) : undefined}>
          {screen.name === 'contents' && <ContentsPage screen={screen} {...pageProps} />}
          {screen.name === 'world' && <WorldBookScreen screen={screen} {...pageProps} />}
          {screen.name === 'characters' && (
            <CharacterDexScreen key={screen.cardId ?? ''} screen={screen} {...pageProps} />
          )}
          {screen.name === 'regions' && (
            <RegionMapScreen key={screen.cardId ?? ''} screen={screen} {...pageProps} />
          )}
          {screen.name === 'story' && <StoryScreen screen={screen} {...pageProps} />}
          {shown.dir && (
            <div key={shown.key} className="book-leaf" data-dir={shown.dir} aria-hidden="true" />
          )}
          <nav className="book-notes" aria-label={strings.book.sections}>
            {SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                className="book-note"
                data-section={section}
                aria-current={screen.name === section ? 'page' : undefined}
                onClick={() => {
                  if (screen.name !== section) open({ name: section, workId })
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
          disabled={!after}
          onClick={() => {
            if (after) open(screenOf(after, workId))
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </main>
    </>
  )
}
