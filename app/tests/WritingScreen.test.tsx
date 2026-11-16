import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Card, Chapter, ChapterText, Job, Warning, Work } from '../src/types'
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

const EPISODE = {
  id: 'c_ep1',
  work_id: 'w_1',
  type: 'episode',
  name: '귀환',
  status: 'complete',
  source_notes: '',
  data: {},
  evidence: {},
  ai_guess: [],
  pinned: [],
  schema_version: 1,
} as unknown as Card
const MIRA = { ...EPISODE, id: 'c_mira', type: 'character', name: '미라' } as unknown as Card

function beat(id: string, order: number, version: number | null) {
  return {
    id,
    order,
    scene: 1,
    source_stage: '발단',
    summary: `${String(order)}번 비트 요약`,
    techniques: [],
    pov: '테오 1인칭',
    mode: '장면화' as const,
    focus: '감정' as const,
    density: '담백' as const,
    tension: 3,
    target_chars: 800,
    version,
    chars: version === null ? null : 12,
  }
}

const CH1: Chapter = {
  id: 'ch_1',
  plan_id: 'pl_1',
  episode_id: 'c_ep1',
  number: 1,
  target_chars: 5500,
  read: false,
  chars: 24,
  beats: [beat('b_1', 1, 1), beat('b_2', 2, 1), beat('b_3', 3, null)],
}
const CH2: Chapter = {
  ...CH1,
  id: 'ch_2',
  number: 2,
  chars: 0,
  beats: [beat('b_4', 1, null)],
}

const FIRST = '테오는 배에서 내렸다. 미라가 웃었다.'
const TEXT1: ChapterText = {
  id: 'ch_1',
  number: 1,
  beats: [
    {
      id: 'b_1',
      order: 1,
      version: 1,
      chars: 21,
      origin: 'generated',
      checked: true,
      text: FIRST,
      sentences: [
        { start: 0, end: 12 },
        { start: 13, end: 21 },
      ],
    },
    {
      id: 'b_2',
      order: 2,
      version: 1,
      chars: 6,
      origin: 'generated',
      checked: false,
      text: '안개가 짙다.',
      sentences: [{ start: 0, end: 7 }],
    },
    {
      id: 'b_3',
      order: 3,
      version: null,
      chars: null,
      origin: null,
      checked: null,
      text: null,
      sentences: null,
    },
  ],
}

const WARNING: Warning = {
  id: 'wr_1',
  beat_id: 'b_1',
  version: 1,
  kind: 'character',
  sentence: 2,
  card_id: 'c_mira',
  status: 'open',
  reason: '미라는 웃지 않는 인물이에요.',
  ignore_reason: null,
}

function job(status: Job['status'], extra: Partial<Job> = {}): Job {
  return {
    jobId: 'job_1',
    kind: 'chapter',
    key: 'chapter:ch_1',
    workId: 'w_1',
    status,
    createdAt: '2026-11-17T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    lastEventId: 0,
    error: null,
    ...extra,
  }
}

type World = {
  work?: Work
  // The chapters once POST .../generate has run (the job is over at once).
  writtenChapters?: Chapter[]
  written?: boolean
  // POST /jobs/.../pause answers with this error code.
  refusePause?: string
  jobs?: Job[]
  events?: string
  warnings?: Warning[]
}
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
      if (path === '/works/w_1/chapters') {
        return json({ chapters: world.written ? world.writtenChapters : [CH1, CH2] })
      }
      if (path === '/works/w_1/cards?type=episode') return json({ cards: [EPISODE] })
      if (path === '/works/w_1/cards') return json({ cards: [EPISODE, MIRA] })
      if (path === '/works/w_1/jobs') return json({ jobs: world.jobs ?? [] })
      if (path === '/chapters/ch_1') return json(TEXT1)
      if (path === '/chapters/ch_1/warnings') return json({ warnings: world.warnings ?? [] })
      if (path === '/chapters/ch_2') {
        return json({ id: 'ch_2', number: 2, beats: [{ ...TEXT1.beats[2], id: 'b_4' }] })
      }
      if (path === '/chapters/ch_2/warnings') return json({ warnings: [] })
      if (method === 'POST' && path === '/chapters/ch_1/generate') {
        if (world.writtenChapters) {
          world.written = true
          world.jobs = [job('done')]
          return json({ jobId: 'job_1' }, 202)
        }
        world.jobs = [job('running')]
        return json({ jobId: 'job_1' }, 202)
      }
      if (method === 'POST' && path.startsWith('/beats/') && path.endsWith('/regenerate')) {
        world.jobs = [job('running', { jobId: 'job_2', kind: 'beat', key: 'beat:b_1' })]
        return json({ jobId: 'job_2' }, 202)
      }
      if (method === 'PATCH' && path === '/warnings/wr_1') {
        const body = JSON.parse(init.body as string) as {
          status: Warning['status']
          reason?: string
        }
        return json({ ...WARNING, status: body.status, ignore_reason: body.reason ?? null })
      }
      if (path.startsWith('/jobs/job_1/events')) {
        return Promise.resolve(new Response(world.events ?? '', { status: 200 }))
      }
      if (path.startsWith('/jobs/job_2/events')) return Promise.resolve(new Response(''))
      const control = /^\/jobs\/(job_\d)\/(pause|resume|cancel)$/.exec(path)
      if (method === 'POST' && control) {
        if (control[2] === 'pause' && world.refusePause) {
          return json({ code: world.refusePause, message: 'no', hint: null }, 409)
        }
        // As the server: a pause asked is kept running until the next beat.
        const status = control[2] === 'cancel' ? 'cancelled' : 'running'
        if (status === 'cancelled') world.jobs = [job('cancelled')]
        return json(job(status))
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
}

const sse = (events: [string, unknown][]) =>
  events
    .map(
      ([type, data], at) =>
        `id: ${String(at + 1)}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join('')

beforeEach(() => {
  useServer.setState({ state: READY })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNavigation.setState({ screen: { name: 'library' } })
})

const SCREEN = { name: 'writing', workId: 'w_1' } as const
const pick = (order: number) =>
  screen.getByRole('button', { name: new RegExp(`^${strings.writing.selectBeat(order)}`) })

test('before the writing stage the page says how to start it and leads to direction', async () => {
  mockServer({ work: { ...WORK, stage: 2, locked_stage: 1 } })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.writing.toDirection }))
  expect(useNavigation.getState().screen).toMatchObject({ name: 'direction', workId: 'w_1' })
  expect(calls.some((call) => call.path === '/works/w_1/chapters')).toBe(false)
})

test('chapters are listed under their episode; the first unfinished one shows its manuscript', async () => {
  mockServer({})
  renderBook(SCREEN)
  const list = await screen.findByRole('navigation', { name: strings.writing.chapters })
  expect(within(list).getByText('귀환')).toBeTruthy()
  const first = within(list).getByRole('button', { name: /1화/ })
  expect(first.getAttribute('aria-current')).toBe('true')
  expect(first.textContent).toContain(strings.writing.rowPartly(2, 3))
  expect(within(list).getByRole('button', { name: /2화/ }).textContent).toContain(
    strings.writing.rowWaiting,
  )
  await screen.findByText(FIRST)
  expect(screen.getByText(strings.writing.counter(24, 5500))).toBeTruthy()
  // Beat 2 was left unchecked (no job checks it): dimmed, and the margin says so in words.
  const second = screen.getByRole('region', { name: strings.writing.beat(2) })
  expect(second.hasAttribute('data-unchecked')).toBe(true)
  expect(within(second).getByText(strings.writing.notChecked)).toBeTruthy()
  expect(pick(2).textContent).toContain(strings.writing.notChecked)
  expect(screen.getByText('3번 비트 요약')).toBeTruthy()
  // Partly written: the button carries on from the last stored beat.
  fireEvent.click(screen.getByRole('button', { name: strings.writing.resume }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/chapters/ch_1/generate')).toBe(
      true,
    )
  })
})

test('a running chapter streams its beat in and can be paused and stopped', async () => {
  mockServer({
    jobs: [job('running')],
    events: sse([
      ['progress', { done: 2, total: 3, etaSec: 75, step: 'write' }],
      ['beat_start', { beatId: 'b_3' }],
      ['sentence', { beatId: 'b_3', text: '문이 열렸다.' }],
      ['sentence', { beatId: 'b_3', text: ' 바람이 불었다.' }],
    ]),
  })
  renderBook(SCREEN)
  await screen.findByText('문이 열렸다. 바람이 불었다.')
  // Being written: dimmed and said to be checked.
  expect(
    within(screen.getByRole('region', { name: strings.writing.beat(3) })).getByText(
      strings.writing.unchecked,
    ),
  ).toBeTruthy()
  const status = screen.getByRole('status')
  expect(status.textContent).toContain(strings.writing.progress(3, 3))
  expect(status.textContent).toContain('1분 15초')
  // No new chapter job while one runs; the beat can't be written again meanwhile.
  expect(screen.queryByRole('button', { name: strings.writing.resume })).toBeNull()
  fireEvent.click(pick(1))
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.writing.regenerate }).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: strings.writing.pause }))
  await screen.findByText(strings.writing.pausing)
  expect(calls.some((c) => c.method === 'POST' && c.path === '/jobs/job_1/pause')).toBe(true)
  // Still running until the beat ends: 계속 takes the pause back.
  fireEvent.click(await screen.findByRole('button', { name: strings.writing.resumeJob }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/jobs/job_1/resume')).toBe(true)
  })
  await screen.findByRole('button', { name: strings.writing.pause })
  fireEvent.click(screen.getByRole('button', { name: strings.writing.stop }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/jobs/job_1/cancel')).toBe(true)
  })
})

test('Ctrl+. pauses and resumes the running job', async () => {
  mockServer({ jobs: [job('paused')], events: sse([['paused', { reason: 'user' }]]) })
  renderBook(SCREEN)
  await screen.findByText(strings.writing.paused)
  fireEvent.keyDown(window, { key: '.', ctrlKey: true })
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/jobs/job_1/resume')).toBe(true)
  })
})

test('a warning underlines its sentence and 무시 keeps a reason', async () => {
  mockServer({ warnings: [WARNING] })
  renderBook(SCREEN)
  const panel = await screen.findByRole('complementary', { name: strings.writing.warningsTitle })
  await within(panel).findByText(WARNING.reason)
  expect(within(panel).getByText(strings.writing.kinds.character)).toBeTruthy()
  expect(within(panel).getByText(strings.writing.evidence('미라'))).toBeTruthy()
  // The sentence it is about, quoted and underlined in the manuscript.
  expect(within(panel).getByText('미라가 웃었다.')).toBeTruthy()
  const manuscript = screen.getByLabelText(strings.writing.manuscript, { selector: 'div' })
  const underlined = manuscript.querySelector('.ms-warned')
  expect(underlined?.textContent).toBe('미라가 웃었다.')
  // The margin mark, named in words too.
  expect(pick(1).textContent).toContain(strings.writing.beatWarnings(1))

  fireEvent.click(within(panel).getByRole('button', { name: strings.writing.ignore }))
  fireEvent.change(within(panel).getByLabelText(strings.writing.ignoreReason), {
    target: { value: ' 의도한 장면 ' },
  })
  fireEvent.click(within(panel).getByRole('button', { name: strings.writing.ignoreConfirm }))
  await within(panel).findByText(strings.writing.ignored(1))
  const patch = calls.find((c) => c.method === 'PATCH')
  expect(JSON.parse(patch?.body ?? '{}')).toEqual({ status: 'ignored', reason: '의도한 장면' })
  expect(manuscript.querySelector('.ms-warned')).toBeNull()
})

test('수정 제안 writes the warned beat again', async () => {
  mockServer({ warnings: [WARNING] })
  renderBook(SCREEN)
  const panel = await screen.findByRole('complementary', { name: strings.writing.warningsTitle })
  fireEvent.click(await within(panel).findByRole('button', { name: strings.writing.suggest }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/beats/b_1/regenerate')).toBe(true)
  })
})

test('Ctrl+Shift+R writes the picked beat again', async () => {
  mockServer({})
  renderBook(SCREEN)
  await screen.findByText(FIRST)
  fireEvent.click(pick(2))
  fireEvent.keyDown(window, { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/beats/b_2/regenerate')).toBe(true)
  })
})

test('a failed job says why; another chapter is opened from the list', async () => {
  mockServer({
    jobs: [job('failed', { error: { code: 'LLM_INVALID_OUTPUT', message: 'no' } })],
  })
  renderBook(SCREEN)
  await screen.findByText(strings.writing.errors.LLM_INVALID_OUTPUT ?? '')
  const list = screen.getByRole('navigation', { name: strings.writing.chapters })
  fireEvent.click(within(list).getByRole('button', { name: /2화/ }))
  await screen.findByRole('button', { name: strings.writing.write })
  expect(screen.queryByText(strings.writing.errors.LLM_INVALID_OUTPUT ?? '')).toBeNull()
})

test('a chapter written to its end stays open; the next unfinished one waits to be picked', async () => {
  const done = { ...CH1, beats: CH1.beats.map((b) => ({ ...b, version: 1, chars: 12 })) }
  mockServer({ writtenChapters: [done, CH2] })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.writing.resume }))
  const list = screen.getByRole('navigation', { name: strings.writing.chapters })
  const first = within(list).getByRole('button', { name: /1화/ })
  await waitFor(() => {
    expect(first.textContent).toContain(strings.writing.rowDone)
  })
  expect(first.getAttribute('aria-current')).toBe('true')
  expect(screen.getByRole('heading', { level: 3, name: /^1화/ })).toBeTruthy()
})

test('a pause the server refuses is not left waiting', async () => {
  mockServer({ jobs: [job('running')], refusePause: 'JOB_NOT_RUNNING' })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.writing.pause }))
  await screen.findByText(strings.writing.errors.JOB_NOT_RUNNING ?? '')
  expect(screen.queryByText(strings.writing.pausing)).toBeNull()
  expect(screen.getByRole('button', { name: strings.writing.pause })).toBeTruthy()
})

test('a beat written again cannot be paused, only stopped', async () => {
  mockServer({ jobs: [job('running', { jobId: 'job_2', kind: 'beat', key: 'beat:b_1' })] })
  renderBook(SCREEN)
  await screen.findByText(strings.writing.beatProgress)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.writing.pause }).disabled,
  ).toBe(true)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.writing.stop }).disabled,
  ).toBe(false)
})

test('a closed failure stays closed when its chapter is opened again', async () => {
  mockServer({
    jobs: [job('failed', { error: { code: 'LLM_INVALID_OUTPUT', message: 'no' } })],
  })
  renderBook(SCREEN)
  const failure = strings.writing.errors.LLM_INVALID_OUTPUT ?? ''
  await screen.findByText(failure)
  fireEvent.click(
    within(screen.getByRole('alert')).getByRole('button', { name: strings.writing.dismiss }),
  )
  const list = screen.getByRole('navigation', { name: strings.writing.chapters })
  fireEvent.click(within(list).getByRole('button', { name: /2화/ }))
  await screen.findByRole('button', { name: strings.writing.write })
  fireEvent.click(within(list).getByRole('button', { name: /1화/ }))
  await screen.findByText(FIRST)
  expect(screen.queryByText(failure)).toBeNull()
})

test('shortcuts stay out of a field being typed in', async () => {
  mockServer({ warnings: [WARNING] })
  renderBook(SCREEN)
  const panel = await screen.findByRole('complementary', { name: strings.writing.warningsTitle })
  await within(panel).findByText(WARNING.reason)
  fireEvent.click(pick(1))
  fireEvent.click(within(panel).getByRole('button', { name: strings.writing.ignore }))
  const field = within(panel).getByLabelText(strings.writing.ignoreReason)
  fireEvent.keyDown(field, { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(calls.some((c) => c.path.endsWith('/regenerate'))).toBe(false)
})

test('the chapter being written opens first, even when the jobs answer last', async () => {
  mockServer({ jobs: [job('running', { jobId: 'job_9', key: 'chapter:ch_2' })] })
  const answer = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/works/w_1/jobs')
        ? new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(answer(url, init))
            }, 100)
          })
        : answer(url, init),
    ),
  )
  renderBook(SCREEN)
  const list = await screen.findByRole('navigation', { name: strings.writing.chapters })
  const second = within(list).getByRole('button', { name: /2화/ })
  await waitFor(() => {
    expect(second.getAttribute('aria-current')).toBe('true')
  })
})
