import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useServer } from '../src/stores/server'
import { useNavigation } from '../src/stores/navigation'
import { strings } from '../src/strings'
import type { Card, Job, PlanRecord, Work } from '../src/types'
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
  stage: 2,
  locked_stage: 1,
  last_item: null,
  color: null,
  cover_id: null,
  updated_at: '2026-10-31T00:00:00.000Z',
}

const base = {
  work_id: 'w_1',
  status: 'complete',
  source_notes: '',
  evidence: {},
  ai_guess: [],
  pinned: [],
  schema_version: 1,
}
const MAIN = { ...base, id: 'c_main', type: 'main_story', name: null, data: {} } as unknown as Card
const PART = {
  ...base,
  id: 'c_p1',
  type: 'part',
  name: '귀환',
  data: { order: 1, title: '귀환' },
} as unknown as Card

function episode(id: string, order: number, name: string, status = 'complete'): Card {
  return {
    ...base,
    status,
    id,
    type: 'episode',
    name,
    data: { part_id: 'c_p1', order, synopsis: `${name} 시놉시스` },
  } as unknown as Card
}

const EP1 = episode('c_ep1', 1, '1화 귀환')
const EP2 = episode('c_ep2', 2, '2화 추격')
const EP3 = episode('c_ep3', 3, '3화 미완', 'incomplete')

const RECORD = {
  id: 'pl_1',
  episode_id: 'c_ep1',
  status: 'directing',
  plan: {
    episode: 'c_ep1',
    chapters: [
      {
        chapter: 1,
        target_chars: 5500,
        scenes: [
          {
            scene: 2,
            status: 'confirmed',
            source: '전개',
            summary: '문을 연다',
            target_chars: 3000,
          },
          { scene: 1, status: 'stale', source: '발단', summary: '돌아온다', target_chars: 2500 },
        ],
      },
    ],
  },
} as unknown as PlanRecord

function job(status: Job['status'], extra: Partial<Job> = {}): Job {
  return {
    jobId: 'job_1',
    kind: 'plan',
    key: 'plan:c_ep1',
    workId: 'w_1',
    status,
    createdAt: '2026-10-31T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    lastEventId: 0,
    error: null,
    ...extra,
  }
}

type World = {
  work?: Work
  jobs?: Job[]
  plans?: Record<string, PlanRecord[]>
  events?: string
  // The job is over before the list first shows it.
  instant?: boolean
}
type Call = { method: string; path: string }

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
      calls.push({ method, path })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(world.work ?? WORK)
      if (path === '/works/w_1/cards?type=main_story') return json({ cards: [MAIN] })
      if (path === '/works/w_1/cards?type=part') return json({ cards: [PART] })
      if (path === '/works/w_1/cards?type=episode') return json({ cards: [EP2, EP1, EP3] })
      if (path === '/works/w_1/jobs') return json({ jobs: world.jobs ?? [] })
      const plans = /^\/episodes\/(c_ep\d)\/plans/.exec(path)
      if (plans) {
        if (method === 'POST') {
          world.jobs = [job(world.instant ? 'done' : 'running')]
          if (world.instant) world.plans = { c_ep1: [RECORD] }
          return json({ jobId: 'job_1' }, 202)
        }
        return json({ plans: world.plans?.[plans[1] ?? ''] ?? [] })
      }
      if (path.startsWith('/jobs/job_1/events'))
        return Promise.resolve(new Response(world.events ?? '', { status: 200 }))
      if (method === 'POST' && path === '/jobs/job_1/cancel') {
        world.jobs = [job('cancelled')]
        return json(job('cancelled'))
      }
      return json({ cards: [], milestones: [], foreshadowing: [], incomplete: [] })
    }),
  )
}

beforeEach(() => {
  useServer.setState({ state: READY })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNavigation.setState({ screen: { name: 'library' } })
})

const SCREEN = { name: 'direction', workId: 'w_1' } as const
const row = (name: RegExp) => screen.findByRole('button', { name })

test('before the direction stage the page says how to start it and leads to the story', async () => {
  mockServer({ work: { ...WORK, stage: 1, locked_stage: 0 } })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.toStory }))
  expect(useNavigation.getState().screen).toMatchObject({ name: 'story', workId: 'w_1' })
})

test('episodes come in order under their part; the first active one opens', async () => {
  mockServer({ plans: { c_ep1: [RECORD] } })
  renderBook(SCREEN)
  const list = await screen.findByRole('navigation', { name: strings.direction.episodes })
  await within(list).findByText(strings.direction.rowProgress(1, 2))
  const names = within(list)
    .getAllByRole('button')
    .map((button) => button.firstChild?.textContent)
  expect(names).toEqual(['1화 귀환', '2화 추격', '3화 미완'])
  expect(within(list).getByText('귀환')).toBeTruthy()
  expect((await row(/1화 귀환/)).getAttribute('aria-current')).toBe('true')
  expect((await row(/3화 미완/)).textContent).toContain(strings.direction.rowInactive)
  expect((await row(/2화 추격/)).textContent).toContain(strings.direction.rowNoPlan)
})

test('a plan lists its chapters and scenes in narration order, each with its status', async () => {
  mockServer({ plans: { c_ep1: [RECORD] } })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.confirmedOf(1, 2))
  expect(screen.getByRole('heading', { name: strings.direction.chapter(1, 5500) })).toBeTruthy()
  const summaries = [...document.querySelectorAll('.direction-scenes > li')].map((item) =>
    item.textContent.includes('문을 연다') ? 'first' : 'second',
  )
  expect(summaries).toEqual(['first', 'second'])
  expect(screen.getByText(strings.direction.sceneStatus.stale)).toBeTruthy()
})

test('an inactive episode says why and cannot be planned', async () => {
  mockServer({})
  renderBook(SCREEN)
  fireEvent.click(await row(/3화 미완/))
  await screen.findByText(strings.direction.inactive)
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
})

test('making a plan starts the job, shows its step, and shows the plan when it ends', async () => {
  mockServer({
    events: 'id: 1\nevent: progress\ndata: {"done":1,"total":2,"etaSec":65,"step":"arrange"}\n\n',
  })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.make }))
  await screen.findByText(strings.direction.steps.arrange ?? '')
  expect(screen.getByText(new RegExp(strings.generation.etaMinutes(1, 5)))).toBeTruthy()
  expect(calls).toContainEqual({ method: 'POST', path: '/episodes/c_ep1/plans' })
  expect((await row(/1화 귀환/)).textContent).toContain(strings.direction.rowMaking)

  world.jobs = [job('done')]
  world.plans = { c_ep1: [RECORD] }
  await screen.findByText(strings.direction.confirmedOf(1, 2), {}, { timeout: 4000 })
  expect(screen.queryByRole('status')).toBeNull()
})

test('a job over before the list first shows it still brings up the plan', async () => {
  mockServer({ instant: true })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.make }))
  await screen.findByText(strings.direction.confirmedOf(1, 2))
})

test('coming back to a running job picks it up without starting another', async () => {
  mockServer({
    jobs: [job('running')],
    events: 'id: 1\nevent: progress\ndata: {"done":0,"total":2,"etaSec":null,"step":"scene"}\n\n',
  })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.steps.scene ?? '')
  expect(screen.getByText(new RegExp(strings.direction.usual))).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST')).toBe(false)
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
})

test('a queued job says it is waiting; cancel stops it', async () => {
  mockServer({ jobs: [job('queued')] })
  renderBook(SCREEN)
  await screen.findByText(strings.generation.queued)
  fireEvent.click(screen.getByRole('button', { name: strings.generation.cancel }))
  await screen.findByRole('button', { name: strings.direction.make })
  expect(calls).toContainEqual({ method: 'POST', path: '/jobs/job_1/cancel' })
})

test('a failed job says why and the plan can be tried again', async () => {
  mockServer({
    jobs: [job('failed', { error: { code: 'LLM_INVALID_OUTPUT', message: 'bad' } })],
  })
  renderBook(SCREEN)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(strings.direction.errors.LLM_INVALID_OUTPUT)
  expect(screen.getByRole('button', { name: strings.direction.make })).toBeTruthy()
})

test('a refused start says why', async () => {
  mockServer({})
  renderBook(SCREEN)
  const make = await screen.findByRole('button', { name: strings.direction.make })
  vi.mocked(fetch).mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 'STAGE_LOCKED', message: 'no', hint: null }), {
        status: 423,
      }),
    ),
  )
  fireEvent.click(make)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(strings.direction.errors.STAGE_LOCKED)
})

test('replacing a plan asks first, cancel is the default, and red confirms', async () => {
  mockServer({ plans: { c_ep1: [RECORD] } })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.replace }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toContain(strings.direction.replaceWhat(2))
  expect(document.activeElement?.textContent).toBe(strings.direction.cancel)
  expect(calls.some((call) => call.method === 'POST')).toBe(false)
  const confirm = within(dialog).getByRole('button', { name: strings.direction.replaceConfirm })
  expect(confirm.hasAttribute('data-danger')).toBe(true)
  fireEvent.click(confirm)
  await waitFor(() => {
    expect(calls).toContainEqual({ method: 'POST', path: '/episodes/c_ep1/plans?replace=true' })
  })
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('once direction is over nothing can be made or replaced', async () => {
  mockServer({
    work: { ...WORK, stage: 3, locked_stage: 2 },
    plans: { c_ep1: [RECORD] },
  })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.confirmedOf(1, 2))
  expect(screen.queryByRole('button', { name: strings.direction.replace })).toBeNull()
  fireEvent.click(await row(/2화 추격/))
  await screen.findByText(strings.direction.noPlanLocked)
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
})
