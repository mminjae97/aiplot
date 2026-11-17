import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Chapter, ChapterBeat, ChapterText, ChapterUpdate, Job, Work } from '../src/types'
import { renderBook } from './bookHarness'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

const WORK: Work = {
  id: 'w_1',
  title: '책',
  stage: 3,
  locked_stage: 2,
  last_item: null,
  color: null,
  cover_id: null,
  updated_at: '2026-11-17T00:00:00.000Z',
}

function beat(id: string, version: number | null): ChapterBeat {
  return {
    id,
    order: 1,
    scene: 1,
    source_stage: '발단',
    summary: '요약',
    techniques: [],
    pov: '테오 1인칭',
    mode: '장면화',
    focus: '감정',
    density: '자세히',
    tension: 3,
    target_chars: 800,
    version,
    chars: version === null ? null : 12,
  }
}

function chapter(number: number, written: boolean, read = false, position = 0): Chapter {
  return {
    id: `ch_${String(number)}`,
    plan_id: 'pl_1',
    episode_id: 'c_ep1',
    number,
    target_chars: 5500,
    read,
    position,
    chars: written ? 12 : 0,
    beats: [beat(`b_${String(number)}`, written ? 1 : null)],
  }
}

function text(number: number, body: string): ChapterText {
  return {
    id: `ch_${String(number)}`,
    number,
    beats: [
      {
        id: `b_${String(number)}`,
        order: 1,
        version: 1,
        chars: body.length,
        origin: 'generated',
        checked: true,
        text: body,
        sentences: [],
      },
    ],
  }
}

type World = { work?: Work; chapters: Chapter[]; refuseMark?: boolean; jobs?: Job[] }
type Call = { method: string; path: string; body?: string }

let calls: Call[]
let world: World

function mockServer(state: World) {
  world = state
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      calls.push({ method, path, body: init.body as string | undefined })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(world.work ?? WORK)
      if (path === '/works/w_1/chapters') return json({ chapters: world.chapters })
      if (path === '/works/w_1/jobs') return json({ jobs: world.jobs ?? [] })
      const found = /^\/chapters\/ch_(\d)$/.exec(path)
      if (found && method === 'GET') {
        const number = Number(found[1])
        return json(text(number, `${String(number)}화 첫 줄.\n\n${String(number)}화 끝 줄.`))
      }
      if (found && method === 'PATCH') {
        if (world.refuseMark) return json({ code: 'INTERNAL_ERROR', message: 'no' }, 500)
        const body = JSON.parse(init.body as string) as ChapterUpdate
        world.chapters = world.chapters.map((c) =>
          c.id === `ch_${found[1] ?? ''}` ? { ...c, ...body } : c,
        )
        return json(world.chapters.find((c) => c.id === `ch_${found[1] ?? ''}`))
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
}

const patches = () =>
  calls
    .filter((c) => c.method === 'PATCH')
    .map((c) => ({ path: c.path, body: JSON.parse(c.body ?? '{}') as ChapterUpdate }))

// jsdom lays nothing out: the reader's text box is given a height (a chapter longer than it).
function tallText() {
  const heights = {
    scrollHeight: { get: () => 1000 },
    clientHeight: { get: () => 200 },
  }
  for (const [key, value] of Object.entries(heights)) {
    // (defined on Element.prototype: the stub on HTMLElement.prototype is deleted after)
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('reader-text') ? value.get() : 0
      },
    })
    restores.push(() => {
      Reflect.deleteProperty(HTMLElement.prototype, key)
    })
  }
}
let restores: (() => void)[] = []

beforeEach(() => {
  useServer.setState({ state: READY })
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const restore of restores) restore()
  restores = []
  useNavigation.setState({ screen: { name: 'library' } })
})

const SCREEN = { name: 'reading', workId: 'w_1' } as const
const CHAPTERS = () => [
  chapter(1, true, true),
  chapter(2, true, false, 0.5),
  chapter(3, false),
  chapter(4, true),
]
const list = () => screen.findByRole('list', { name: strings.reading.chapters })
const rows = async () =>
  within(await list())
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.reading-chapter span')?.textContent)
const open = (number: number) =>
  screen.getByRole('button', { name: new RegExp(`^${strings.reading.chapterName(number)}`) })

test('before the writing stage the page says so and leads to writing', async () => {
  mockServer({ work: { ...WORK, stage: 2, locked_stage: 1 }, chapters: [] })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.reading.toWriting }))
  expect(useNavigation.getState().screen).toEqual({ name: 'writing', workId: 'w_1' })
})

test('the chapters are listed newest first, read ones bold, those not finished closed', async () => {
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  expect(await rows()).toEqual(['4화', '3화', '2화', '1화'])
  const items = within(await list()).getAllByRole('listitem')
  expect(items.map((row) => row.hasAttribute('data-read'))).toEqual([false, false, false, true])
  expect(within(items[3] as HTMLElement).getByText(strings.reading.read)).toBeTruthy()
  const writing = open(3) as HTMLButtonElement
  expect(writing.disabled).toBe(true)
  expect(writing.textContent).toContain(strings.reading.notWritten)
  expect(screen.getByText(strings.reading.pick)).toBeTruthy()
  // The order chosen is remembered.
  fireEvent.change(screen.getByRole('combobox', { name: strings.reading.sort }), {
    target: { value: 'oldest' },
  })
  expect(await rows()).toEqual(['1화', '2화', '3화', '4화'])
  expect(localStorage.getItem('aiplot.reader.order')).toBe('oldest')
})

test('이어 읽기 opens the first unread chapter where reading stopped', async () => {
  tallText()
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.reading.continue }))
  const reader = await screen.findByRole('document', { name: strings.reading.chapterName(2) })
  await within(reader).findByText('2화 끝 줄.')
  // Halfway through the 800px it can scroll.
  expect(reader.scrollTop).toBe(400)
  expect(open(2).getAttribute('aria-current')).toBe('true')
})

test('where reading stops is saved; reading to the end marks the chapter read', async () => {
  tallText()
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  fireEvent.click(open(4))
  const reader = await screen.findByRole('document', { name: strings.reading.chapterName(4) })
  await within(reader).findByText('4화 첫 줄.')
  expect(reader.scrollTop).toBe(0)
  reader.scrollTop = 200
  fireEvent.scroll(reader)
  await waitFor(
    () => {
      expect(patches()).toEqual([{ path: '/chapters/ch_4', body: { position: 0.25 } }])
    },
    { timeout: 2000 },
  )
  reader.scrollTop = 800
  fireEvent.scroll(reader)
  await waitFor(() => {
    expect(patches()).toContainEqual({ path: '/chapters/ch_4', body: { read: true } })
  })
  const row = open(4).closest('li') as HTMLElement
  await waitFor(() => {
    expect(row.hasAttribute('data-read')).toBe(true)
  })
  // Leaving the chapter saves where it was left.
  fireEvent.click(open(1))
  await waitFor(() => {
    expect(patches()).toContainEqual({ path: '/chapters/ch_4', body: { position: 1 } })
  })
})

test('← and → open the finished chapters around the one open', async () => {
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  fireEvent.click(open(2))
  await screen.findByRole('document', { name: strings.reading.chapterName(2) })
  // Chapter 3 is not finished: → goes on to 4.
  expect(screen.getByRole('button', { name: strings.reading.nextLabel(4) })).toBeTruthy()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  await screen.findByRole('document', { name: strings.reading.chapterName(4) })
  expect(screen.queryByRole('button', { name: /^다음 화/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: strings.reading.prevLabel(2) }))
  await screen.findByRole('document', { name: strings.reading.chapterName(2) })
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  await screen.findByRole('document', { name: strings.reading.chapterName(1) })
  // Not while typing in a field.
  fireEvent.keyDown(screen.getByRole('combobox', { name: strings.reading.sort }), {
    key: 'ArrowRight',
  })
  expect(screen.getByRole('document', { name: strings.reading.chapterName(1) })).toBeTruthy()
})

test('a chapter that shows whole is read once opened', async () => {
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  fireEvent.click(open(4))
  await waitFor(() => {
    expect(patches()).toEqual([{ path: '/chapters/ch_4', body: { read: true } }])
  })
})

test('읽음 is toggled in the list; a mark not stored says so', async () => {
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  const box = screen.getByRole<HTMLInputElement>('checkbox', { name: strings.reading.readMark(1) })
  expect(box.checked).toBe(true)
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: strings.reading.readMark(3) }).disabled,
  ).toBe(true)
  fireEvent.click(box)
  await waitFor(() => {
    expect(box.checked).toBe(false)
  })
  // Unread again: 이어 읽기 then starts it over.
  expect(patches()).toEqual([{ path: '/chapters/ch_1', body: { read: false, position: 0 } }])
  world.refuseMark = true
  fireEvent.click(box)
  expect((await screen.findByRole('alert')).textContent).toBe(strings.reading.markFailed)
  expect(box.checked).toBe(false)
})

test('the type is made larger and looser and remembered', async () => {
  tallText()
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  fireEvent.click(open(1))
  const reader = await screen.findByRole('document', { name: strings.reading.chapterName(1) })
  expect(reader.style.fontSize).toBe('17px')
  expect(reader.style.lineHeight).toBe('1.7')
  fireEvent.click(screen.getByRole('button', { name: strings.reading.larger }))
  fireEvent.click(screen.getByRole('button', { name: strings.reading.looser }))
  expect(reader.style.fontSize).toBe('18px')
  expect(reader.style.lineHeight).toBe('1.8')
  expect(JSON.parse(localStorage.getItem('aiplot.reader.type') ?? '{}')).toEqual({
    size: 18,
    line: 1.8,
  })
  for (let i = 0; i < 10; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: strings.reading.smaller }))
  }
  expect(reader.style.fontSize).toBe('15px')
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.reading.smaller }).disabled,
  ).toBe(true)
})

function writingJob(status: Job['status']): Job {
  return {
    jobId: 'job_1',
    kind: 'chapter',
    key: 'chapter:ch_3',
    workId: 'w_1',
    status,
    createdAt: '2026-11-17T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    lastEventId: 0,
    error: null,
  }
}

test('opening at the end is not reading to it: the opening scroll marks nothing', async () => {
  tallText()
  mockServer({ chapters: [chapter(1, true, false, 1)] })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.reading.continue }))
  const reader = await screen.findByRole('document', { name: strings.reading.chapterName(1) })
  await within(reader).findByText('1화 끝 줄.')
  expect(reader.scrollTop).toBe(800)
  // Chromium follows the opening's own scroll with a scroll event.
  fireEvent.scroll(reader)
  await new Promise((done) => setTimeout(done, 50))
  expect(patches()).toEqual([])
  // The reader's own scrolling to the end does.
  reader.scrollTop = 500
  fireEvent.scroll(reader)
  reader.scrollTop = 800
  fireEvent.scroll(reader)
  await waitFor(() => {
    expect(patches()).toContainEqual({ path: '/chapters/ch_1', body: { read: true } })
  })
})

test('PageUp and PageDown scroll the reader; elsewhere they turn the book', async () => {
  mockServer({ chapters: CHAPTERS() })
  renderBook(SCREEN)
  await list()
  fireEvent.click(open(1))
  const reader = await screen.findByRole('document', { name: strings.reading.chapterName(1) })
  fireEvent.keyDown(reader, { key: 'PageUp' })
  expect(useNavigation.getState().screen).toEqual(SCREEN)
  fireEvent.keyDown(document.body, { key: 'PageUp' })
  await waitFor(() => {
    expect(useNavigation.getState().screen).toEqual({ name: 'writing', workId: 'w_1' })
  })
})

test('a chapter written in the background is offered once its job ends', async () => {
  mockServer({ chapters: CHAPTERS(), jobs: [writingJob('running')] })
  renderBook(SCREEN)
  await list()
  expect((open(3) as HTMLButtonElement).disabled).toBe(true)
  world.chapters = world.chapters.map((c) => (c.number === 3 ? chapter(3, true) : c))
  world.jobs = [writingJob('done')]
  await waitFor(
    () => {
      expect((open(3) as HTMLButtonElement).disabled).toBe(false)
    },
    { timeout: 5000 },
  )
})
