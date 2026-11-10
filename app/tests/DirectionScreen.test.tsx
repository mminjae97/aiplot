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
            core: '문 너머',
            reveal: ['집이 비어 있다'],
            beats: [{ order: 1, tension: 3 }],
            target_chars: 3000,
          },
          {
            scene: 1,
            status: 'stale',
            source: '발단',
            summary: '돌아온다',
            core: '귀환',
            reveal: [],
            beats: [],
            target_chars: 2500,
          },
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
  // The answer to PATCH /plans/pl_1.
  patched?: PlanRecord
  // POST /episodes/.../plans and PATCH /plans/pl_1 answer with this error code.
  refuse?: string
  plansFail?: boolean
  slowPlans?: boolean
}
type Call = { method: string; path: string }

let calls: Call[]
let patches: string[]
let world: World

function mockServer(state: World) {
  world = state
  calls = []
  patches = []
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
        if (method === 'POST' && world.refuse) {
          return json({ code: world.refuse, message: 'no', hint: null }, 423)
        }
        if (method === 'GET' && world.plansFail) {
          return json({ code: 'INTERNAL_ERROR', message: 'no', hint: null }, 500)
        }
        if (method === 'GET' && world.slowPlans) {
          const answer = json({ plans: world.plans?.[plans[1] ?? ''] ?? [] })
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(answer)
            }, 100)
          })
        }
        if (method === 'POST') {
          world.jobs = [job(world.instant ? 'done' : 'running')]
          if (world.instant) world.plans = { c_ep1: [RECORD] }
          return json({ jobId: 'job_1' }, 202)
        }
        return json({ plans: world.plans?.[plans[1] ?? ''] ?? [] })
      }
      if (method === 'PATCH' && path === '/plans/pl_1') {
        patches.push(init.body as string)
        if (world.refuse) return json({ code: world.refuse, message: 'no', hint: null }, 422)
        return json(world.patched ?? RECORD)
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

test('a plan is laid out in story order over narration, and a scene opens on click', async () => {
  mockServer({ plans: { c_ep1: [RECORD] } })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.confirmedOf(1, 2))
  const timeline = screen.getByRole('group', { name: strings.direction.timeline })
  const names = within(timeline)
    .getAllByRole('button')
    .map((node) => node.querySelector('.timeline-scene-name')?.textContent)
  // Story order first (1, 2), then as told (2, 1): the moved scene is marked in both rows.
  expect(names.filter((name) => name?.includes(strings.direction.reorderedMark))).toHaveLength(2)
  expect(names.map((name) => name?.replace(/\D/g, ''))).toEqual(['1', '2', '2', '1'])
  expect(within(timeline).getByText(strings.direction.chapter(1, 5500))).toBeTruthy()

  // The first told opens; its core and reveals are shown.
  expect(screen.getByText('문을 연다')).toBeTruthy()
  expect(screen.getByText('문 너머')).toBeTruthy()
  expect(screen.getByText('집이 비어 있다')).toBeTruthy()

  const stale = within(timeline).getAllByRole('button', {
    name: new RegExp(strings.direction.sceneStatus.stale),
  })
  fireEvent.click(stale[0] as HTMLElement)
  expect(await screen.findByText('돌아온다')).toBeTruthy()
  expect(screen.queryByText('문을 연다')).toBeNull()
  expect(screen.getByText(strings.direction.sceneStatus.stale)).toBeTruthy()
  expect(stale[0]?.getAttribute('aria-current')).toBe('true')
})

const THREE = {
  ...RECORD,
  plan: {
    episode: 'c_ep1',
    chapters: [
      {
        chapter: 1,
        target_chars: 5500,
        scenes: [1, 2].map((scene) => ({
          scene,
          status: 'undirected',
          source: '위기',
          summary: `요약 ${String(scene)}`,
          core: '핵심',
          reveal: [],
          beats: [],
          target_chars: 2750,
        })),
      },
      {
        chapter: 2,
        target_chars: 5500,
        scenes: [3].map((scene) => ({
          scene,
          status: 'undirected',
          source: '위기',
          summary: `요약 ${String(scene)}`,
          core: '핵심',
          reveal: [],
          beats: [],
          target_chars: 5500,
        })),
      },
    ],
  },
} as unknown as PlanRecord

/** The told row of the timeline, 300px wide from x = 0: 100px a column. */
async function toldRow() {
  const timeline = await screen.findByRole('group', { name: strings.direction.timeline })
  const nodes = within(timeline).getAllByRole('button')
  const told = nodes.slice(nodes.length / 2)
  const row = told[0]?.parentElement as HTMLElement
  row.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
  told.forEach((node) => {
    node.setPointerCapture = () => undefined
  })
  return { timeline, told }
}

function dragTo(node: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(node, { clientX: from, button: 0, pointerId: 1 })
  fireEvent.pointerMove(node, { clientX: to, pointerId: 1 })
  fireEvent.pointerUp(node, { clientX: to, pointerId: 1 })
}

test('dragging a told scene sends the new order, and the answer is shown', async () => {
  const moved = {
    ...THREE,
    plan: {
      ...THREE.plan,
      chapters: [
        { ...THREE.plan.chapters[0], scenes: [...THREE.plan.chapters[0].scenes].reverse() },
        THREE.plan.chapters[1],
      ],
    },
  } as unknown as PlanRecord
  mockServer({ plans: { c_ep1: [THREE] }, patched: moved })
  renderBook(SCREEN)
  const { timeline, told } = await toldRow()
  dragTo(told[0] as HTMLElement, 50, 180)
  await waitFor(() => {
    expect(patches.map((body) => JSON.parse(body) as unknown)).toEqual([
      { chapters: [[2, 1], [3]] },
    ])
  })
  await waitFor(() => {
    const names = within(timeline)
      .getAllByRole('button')
      .map((node) => node.querySelector('.timeline-scene-name')?.textContent.replace(/\D/g, ''))
    expect(names).toEqual(['1', '2', '3', '2', '1', '3'])
  })
  // The click ending the drag does not pick the scene: the first told stays open.
  fireEvent.click(told[0] as HTMLElement)
  expect(screen.getByText('요약 2')).toBeTruthy()
  expect(screen.queryByText('요약 1')).toBeNull()
})

test('a scene that barely moves is a click: it opens, nothing is sent', async () => {
  mockServer({ plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  const { told } = await toldRow()
  dragTo(told[1] as HTMLElement, 150, 152)
  fireEvent.click(told[1] as HTMLElement)
  await screen.findByText('요약 2')
  expect(patches).toEqual([])
})

test('dropped where it was, nothing is sent', async () => {
  mockServer({ plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  const { told } = await toldRow()
  dragTo(told[0] as HTMLElement, 50, 40)
  expect(patches).toEqual([])
})

test('dragging a cut moves it between scenes', async () => {
  mockServer({ plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  await toldRow()
  const cut = screen.getByRole('separator', { name: strings.direction.cutLabel(1) })
  cut.setPointerCapture = () => undefined
  dragTo(cut, 200, 95)
  await waitFor(() => {
    expect(patches.map((body) => JSON.parse(body) as unknown)).toEqual([
      { chapters: [[1], [2, 3]] },
    ])
  })
})

test('a refused change says why and the plan stays', async () => {
  mockServer({ plans: { c_ep1: [THREE] }, refuse: 'PLAN_LAYOUT_INVALID' })
  renderBook(SCREEN)
  const { told } = await toldRow()
  dragTo(told[0] as HTMLElement, 50, 180)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(strings.direction.errors.PLAN_LAYOUT_INVALID)
})

test('once locked nothing drags', async () => {
  mockServer({ work: { ...WORK, stage: 3, locked_stage: 2 }, plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  const { told } = await toldRow()
  dragTo(told[0] as HTMLElement, 50, 180)
  expect(patches).toEqual([])
  expect(screen.queryByRole('separator')).toBeNull()
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

test('a job already running is picked up without starting another', async () => {
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
  mockServer({ refuse: 'STAGE_LOCKED' })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.make }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(strings.direction.errors.STAGE_LOCKED)
})

test('a closed failure stays closed when the reader comes back to the episode', async () => {
  mockServer({
    plans: { c_ep1: [RECORD] },
    jobs: [job('failed', { error: { code: 'LLM_INVALID_OUTPUT', message: 'bad' } })],
  })
  renderBook(SCREEN)
  const alert = await screen.findByRole('alert')
  fireEvent.click(within(alert).getByRole('button', { name: strings.direction.dismiss }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(await row(/2화 추격/))
  await screen.findByText(strings.direction.noPlan)
  fireEvent.click(await row(/1화 귀환/))
  await screen.findByText(strings.direction.confirmedOf(1, 2))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a plan that cannot be read offers a retry, not a new plan', async () => {
  mockServer({ plansFail: true })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.loadFailed)
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
  world.plansFail = false
  fireEvent.click(screen.getByRole('button', { name: strings.direction.retry }))
  await screen.findByRole('button', { name: strings.direction.make })
  expect(screen.queryByRole('alert')).toBeNull()
})

test('the make button stays away while a finished job brings its plan', async () => {
  mockServer({ jobs: [job('done')], plans: { c_ep1: [RECORD] }, slowPlans: true })
  renderBook(SCREEN)
  await screen.findByRole('navigation', { name: strings.direction.episodes })
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
  await screen.findByText(strings.direction.confirmedOf(1, 2))
  expect(screen.queryByRole('button', { name: strings.direction.make })).toBeNull()
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
