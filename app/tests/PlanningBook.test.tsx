import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Work } from '../src/types'
import { renderBook } from './bookHarness'
import { NO_DIALOGS } from './serverFixtures'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

const WORK: Work = {
  id: 'w_1',
  title: '책',
  stage: 1,
  locked_stage: 0,
  last_item: null,
  color: null,
  cover_id: null,
  updated_at: '2026-10-31T00:00:00.000Z',
}

const MAIN = {
  id: 'c_main',
  work_id: 'w_1',
  type: 'main_story',
  name: null,
  status: 'complete',
  data: { theme: '주제', premise: null, ending: null, milestones: [] },
}

/** An empty book, or one with a main story (so the story's parts step is open). */
function serve(options: { main?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(WORK)
      if (path === '/works/w_1/cards?type=main_story')
        return json({ cards: options.main ? [MAIN] : [] })
      if (path.startsWith('/works/w_1/cards')) return json({ cards: [] })
      if (path.startsWith('/works/w_1/relations')) return json({ relations: [] })
      if (path === '/works/w_1/region-links') return json({ links: [] })
      if (path === '/works/w_1/completeness')
        return json({ milestones: [], foreshadowing: [], incomplete: [] })
      if (path === '/works/w_1/drafts') return json({}, 500)
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
}

beforeEach(() => {
  useServer.setState({ state: READY })
  window.aiplot = {
    server: {
      get: () => Promise.resolve(READY),
      retry: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    window: {
      minimize: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
    dialog: NO_DIALOGS,
  }
  try {
    localStorage.removeItem('aiplot.dex.view')
  } catch {
    // no storage in this environment
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const next = () => screen.getByRole('button', { name: strings.book.next })
const prev = () => screen.getByRole('button', { name: strings.book.prev })
const at = () => useNavigation.getState().screen

test('the desk beside the book turns one smallest page at a time, in reading order', async () => {
  serve({ main: true })
  renderBook({ name: 'contents', workId: 'w_1' })
  expect(await screen.findByRole('heading', { name: strings.contents.heading })).toBeTruthy()
  expect(prev().getAttribute('aria-disabled') === 'true').toBe(true)
  const seen: unknown[] = []
  // contents → 6 bookmarks → 도감 → 관계도 → map → story ① → ② (③ stays closed).
  for (let i = 0; i < 11; i += 1) {
    await waitFor(() => {
      expect(next().getAttribute('aria-disabled') === 'true').toBe(false)
    })
    fireEvent.click(next())
    seen.push(at())
  }
  expect(seen).toEqual([
    { name: 'world', workId: 'w_1', tab: 'rule' },
    { name: 'world', workId: 'w_1', tab: 'faction' },
    { name: 'world', workId: 'w_1', tab: 'history' },
    { name: 'world', workId: 'w_1', tab: 'culture' },
    { name: 'world', workId: 'w_1', tab: 'other' },
    { name: 'world', workId: 'w_1', tab: 'terms' },
    { name: 'characters', workId: 'w_1', view: 'cards' },
    { name: 'characters', workId: 'w_1', view: 'graph' },
    { name: 'regions', workId: 'w_1' },
    { name: 'story', workId: 'w_1', step: 'main' },
    { name: 'story', workId: 'w_1', step: 'parts' },
  ])
  // Episodes are not open (no part yet): the last page.
  expect(next().getAttribute('aria-disabled') === 'true').toBe(true)
  fireEvent.click(prev())
  expect(at()).toEqual({ name: 'story', workId: 'w_1', step: 'main' })
})

test('the open bookmark of the world book turns to the next category; the glossary to the dex', async () => {
  serve()
  renderBook({ name: 'world', workId: 'w_1', tab: 'terms' })
  await waitFor(() => {
    expect(next().getAttribute('aria-disabled') === 'true').toBe(false)
  })
  fireEvent.click(next())
  expect(at()).toEqual({ name: 'characters', workId: 'w_1', view: 'cards' })
  // Opening a bookmark directly is a page turn too.
  fireEvent.click(prev())
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'terms' })
  fireEvent.click(await screen.findByRole('tab', { name: strings.drawer.category.faction }))
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'faction' })
})

test('post-it notes open each section and say which one is open', async () => {
  serve()
  renderBook({ name: 'contents', workId: 'w_1' })
  const notes = await screen.findByRole('navigation', { name: strings.book.sections })
  expect(
    within(notes)
      .getAllByRole('button')
      .map((note) => note.textContent),
  ).toEqual(['목차', '세계관', '캐릭터', '지역', '스토리'])
  expect(within(notes).getByRole('button', { name: '목차' }).getAttribute('aria-current')).toBe(
    'page',
  )
  fireEvent.click(within(notes).getByRole('button', { name: '지역' }))
  expect(at()).toEqual({ name: 'regions', workId: 'w_1' })
  expect(within(notes).getByRole('button', { name: '지역' }).getAttribute('aria-current')).toBe(
    'page',
  )
})

test('turning to another section plays a leaf; tabs within a section change in place', async () => {
  // Motion allowed (jsdom has no matchMedia, which the book reads as no motion).
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
  serve()
  const view = renderBook({ name: 'contents', workId: 'w_1' })
  await screen.findByRole('heading', { name: strings.contents.heading })
  const leaf = () => view.container.querySelector('.book-leaf')?.getAttribute('data-dir')
  const notes = screen.getByRole('navigation', { name: strings.book.sections })
  expect(leaf()).toBeUndefined()
  fireEvent.keyDown(window, { key: 'PageDown' })
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'rule' })
  expect(leaf()).toBe('next')
  // The leaf is a picture: never read out, never clicked.
  expect(view.container.querySelector('.book-turn-clip')?.getAttribute('aria-hidden')).toBe('true')
  // The contents' note turns over with the leaf (front as it was, back as it is now); the
  // note itself shows again once the leaf has landed.
  expect(view.container.querySelectorAll('.leaf-note')).toHaveLength(2)
  const contentsNote = within(notes).getByRole('button', { name: '목차' })
  expect(contentsNote.style.opacity).toBe('0')
  // The back of the leaf shows the new page once it has drawn.
  await waitFor(() => {
    expect(view.container.querySelector('.leaf-back .spread.world-book')).not.toBeNull()
  })
  // A click on the book while it turns ends the turn, not reaching the page under it.
  fireEvent.pointerDown(view.container.querySelector('.book-turning') as Element)
  expect(leaf()).toBeUndefined()
  expect(contentsNote.style.opacity).toBe('')
  // Within the world book, neither the desk nor a bookmark turns a leaf.
  fireEvent.click(next())
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'faction' })
  expect(leaf()).toBeUndefined()
  fireEvent.click(await screen.findByRole('tab', { name: strings.drawer.category.history }))
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'history' })
  expect(leaf()).toBeUndefined()
  // A post-it note to another section turns, back as well as on.
  fireEvent.click(within(notes).getByRole('button', { name: '지역' }))
  expect(at()).toEqual({ name: 'regions', workId: 'w_1' })
  expect(leaf()).toBe('next')
  fireEvent.click(within(notes).getByRole('button', { name: '목차' }))
  expect(at()).toEqual({ name: 'contents', workId: 'w_1' })
  expect(leaf()).toBe('prev')
})

test('without motion (reduced, or no way to ask) pages turn with no leaf', async () => {
  serve()
  const view = renderBook({ name: 'contents', workId: 'w_1' })
  await screen.findByRole('heading', { name: strings.contents.heading })
  fireEvent.keyDown(window, { key: 'PageDown' })
  expect(at()).toEqual({ name: 'world', workId: 'w_1', tab: 'rule' })
  expect(view.container.querySelector('.book-leaf')).toBeNull()
})

test('post-it notes of sections already read stick out on the left, those ahead from under the page', async () => {
  serve()
  renderBook({ name: 'regions', workId: 'w_1' })
  const notes = await screen.findByRole('navigation', { name: strings.book.sections })
  expect(
    within(notes)
      .getAllByRole('button')
      .map((note) => note.getAttribute('data-side')),
  ).toEqual(['past', 'past', 'past', 'open', 'ahead'])
})

test('while a drawer is open the book takes no input and pages do not turn', async () => {
  serve()
  renderBook({ name: 'world', workId: 'w_1' })
  fireEvent.click(await screen.findByRole('button', { name: strings.worldBook.newEntry }))
  await waitFor(() => {
    expect(document.querySelector('main.desk')?.hasAttribute('inert')).toBe(true)
  })
  expect(screen.getByRole('button', { name: strings.contents.back }).hasAttribute('disabled')).toBe(
    true,
  )
  fireEvent.keyDown(window, { key: 'PageDown' })
  expect(at()).toEqual({ name: 'world', workId: 'w_1' })
})

test('a closed story step only explains itself; the book keeps its page and can turn', async () => {
  serve({ main: true })
  renderBook({ name: 'story', workId: 'w_1', step: 'parts' })
  fireEvent.click(await screen.findByRole('tab', { name: strings.story.stepEpisodes }))
  expect(await screen.findByText(strings.story.needParts)).toBeTruthy()
  expect(at()).toEqual({ name: 'story', workId: 'w_1', step: 'parts' })
  expect(prev().getAttribute('aria-disabled')).toBe('false')
  fireEvent.click(prev())
  expect(at()).toEqual({ name: 'story', workId: 'w_1', step: 'main' })
})
