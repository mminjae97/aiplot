import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useServer } from '../src/stores/server'
import { useNavigation } from '../src/stores/navigation'
import { strings } from '../src/strings'
import { DEVICES } from '../src/strings/devices'
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

const SIDE = {
  ai_devices: [],
  sub_devices: [],
  devices: [],
  effects: [],
  situations: [],
  recommended: [],
  chosen: [],
}

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
            ...SIDE,
            reveal: ['집이 비어 있다'],
            beats: [
              {
                order: 1,
                summary: '비트',
                techniques: [],
                pov: '테오 1인칭',
                mode: '장면화',
                focus: '감정',
                density: '담백',
                tension: 3,
                target_chars: 3000,
              },
            ],
            target_chars: 3000,
          },
          {
            scene: 1,
            status: 'stale',
            source: '발단',
            summary: '돌아온다',
            core: '귀환',
            ...SIDE,
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
  techniques?: Record<string, unknown>
  catalog?: unknown[]
  afterDevices?: PlanRecord
  refusePick?: string
  refuseDirect?: string
  refuseBeats?: string
  directDone?: PlanRecord
  afterConfirm?: PlanRecord
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
let deviceSaves: { devices: string[] }[]
let picks: { techniques: string[] }[]
let directs: string[]
let beatSaves: { beats: unknown[] }[]
let confirms: string[]
let world: World

function mockServer(state: World) {
  world = state
  calls = []
  patches = []
  deviceSaves = []
  picks = []
  directs = []
  beatSaves = []
  confirms = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      calls.push({ method, path })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1/stage/advance-preview') {
        return json({ stage: 2, active_episodes: 2, unconfirmed_episodes: 0, incomplete: [] })
      }
      if (method === 'POST' && path === '/works/w_1/stage/advance') {
        return json({ ...WORK, stage: 3, locked_stage: 2 })
      }
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
      if (path.startsWith('/techniques?q=')) {
        return json({ techniques: world.catalog ?? [] })
      }
      const technique = /^\/techniques\/(.+)$/.exec(path)
      if (technique) {
        const found = world.techniques?.[technique[1] ?? '']
        return found
          ? json(found)
          : json({ code: 'TECHNIQUE_NOT_FOUND', message: 'no', hint: null }, 404)
      }
      if (method === 'PUT' && path.endsWith('/devices')) {
        const body = JSON.parse(init.body as string) as { devices: string[] }
        deviceSaves.push(body)
        if (world.afterDevices) return json(world.afterDevices)
        // As the server does: the plan comes back with the devices saved.
        const saved = JSON.parse(JSON.stringify(world.plans?.c_ep1?.[0])) as PlanRecord
        saved.plan.chapters[0].scenes.forEach((scene) => {
          scene.devices = body.devices as PlanRecord['plan']['chapters'][0]['scenes'][0]['devices']
        })
        world.plans = { c_ep1: [saved] }
        return json(saved)
      }
      if (method === 'POST' && path.endsWith('/pick')) {
        picks.push(JSON.parse(init.body as string) as { techniques: string[] })
        if (world.refusePick) {
          return json({ code: world.refusePick, message: 'no', hint: null }, 422)
        }
        return json(world.plans?.c_ep1?.[0])
      }
      if (method === 'POST' && path.endsWith('/direct')) {
        directs.push(path)
        if (world.refuseDirect) {
          return json({ code: world.refuseDirect, message: 'no', hint: null }, 409)
        }
        world.jobs = [
          job(world.directDone ? 'done' : 'running', {
            jobId: 'job_2',
            kind: 'direct',
            key: 'direct:pl_1:1',
          }),
        ]
        if (world.directDone) world.plans = { c_ep1: [world.directDone] }
        return json({ jobId: 'job_2' }, 202)
      }
      if (method === 'PUT' && path.endsWith('/beats')) {
        beatSaves.push(JSON.parse(init.body as string) as { beats: unknown[] })
        if (world.refuseBeats) {
          return json({ code: world.refuseBeats, message: 'no', hint: null }, 422)
        }
        return json(world.plans?.c_ep1?.[0])
      }
      if (method === 'POST' && path.endsWith('/confirm')) {
        confirms.push(path)
        return json(world.afterConfirm ?? world.plans?.c_ep1?.[0])
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
  const names = [...timeline.querySelectorAll('.timeline-scene-name')].map(
    (node) => node.textContent,
  )
  // Story order first (1, 2), then as told (2, 1): the moved scene is marked in both rows.
  expect(names.filter((name) => name.includes(strings.direction.reorderedMark))).toHaveLength(2)
  expect(names.map((name) => name.replace(/\D/g, ''))).toEqual(['1', '2', '2', '1'])
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
          ...SIDE,
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
          ...SIDE,
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
  const nodes = [...timeline.querySelectorAll<HTMLElement>('.timeline-scene')]
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
    const names = [...timeline.querySelectorAll('.timeline-scene-name')].map((node) =>
      node.textContent.replace(/\D/g, ''),
    )
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

test('+ between two scenes of a chapter adds a cut', async () => {
  mockServer({ plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  await toldRow()
  // No + where a cut already is.
  expect(screen.queryByRole('button', { name: strings.direction.addCut(2) })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: strings.direction.addCut(1) }))
  await waitFor(() => {
    expect(patches.map((body) => JSON.parse(body) as unknown)).toEqual([
      { chapters: [[1], [2], [3]] },
    ])
  })
})

test('× on a cut joins its two chapters', async () => {
  mockServer({ plans: { c_ep1: [THREE] } })
  renderBook(SCREEN)
  await toldRow()
  fireEvent.click(screen.getByRole('button', { name: strings.direction.removeCut(1, 2) }))
  await waitFor(() => {
    expect(patches.map((body) => JSON.parse(body) as unknown)).toEqual([{ chapters: [[1, 2, 3]] }])
  })
})

test('at five chapters no more can be added', async () => {
  const chapters = [1, 2, 3, 4, 5].map((chapter) => ({
    chapter,
    target_chars: 5500,
    scenes: [chapter * 10, chapter * 10 + 1].map((scene) => ({
      ...SIDE,
      scene,
      status: 'undirected',
      source: '위기',
      summary: `요약 ${String(scene)}`,
      core: '핵심',
      reveal: [],
      beats: [],
      target_chars: 2750,
    })),
  }))
  mockServer({
    plans: { c_ep1: [{ ...THREE, plan: { episode: 'c_ep1', chapters } } as unknown as PlanRecord] },
  })
  renderBook(SCREEN)
  await toldRow()
  expect(screen.queryByRole('button', { name: strings.direction.addCut(10) })).toBeNull()
  expect(screen.getByRole('button', { name: strings.direction.removeCut(1, 2) })).toBeTruthy()
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
  expect(screen.queryByRole('button', { name: strings.direction.addCut(1) })).toBeNull()
  expect(screen.queryByRole('button', { name: strings.direction.removeCut(1, 2) })).toBeNull()
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

function card(id: string, name: string, conflicts: string[] = []) {
  return {
    id,
    name,
    name_en: `${name} en`,
    description: `${name} 설명`,
    example: `${name} 예시`,
    scope: ['장면'],
    conflicts_with: conflicts,
  }
}

const IDS = ['tech_a', 'tech_b', 'tech_c', 'tech_d', 'tech_e']
const CARDS: Record<string, unknown> = {
  tech_a: card('tech_a', '알파'),
  tech_b: card('tech_b', '베타'),
  tech_c: card('tech_c', '감마', ['tech_a']),
  tech_d: card('tech_d', '델타'),
  tech_e: card('tech_e', '엡실론'),
  tech_x: card('tech_x', '제타'),
}

function sided(extra: Record<string, unknown> = {}) {
  return {
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
              ...SIDE,
              scene: 1,
              status: 'undirected',
              source: '위기',
              summary: '요약',
              core: '핵심',
              reveal: [],
              beats: [],
              target_chars: 5500,
              ai_devices: ['overhear'],
              sub_devices: ['knowledge_gap'],
              devices: ['overhear'],
              recommended: IDS.map((technique, at) => ({
                rank: at + 1,
                technique,
                devices: at === 0 ? ['overhear'] : [],
                effects: at === 0 ? ['긴장'] : [],
                situations: [],
              })),
              ...extra,
            },
          ],
        },
      ],
    },
  } as unknown as PlanRecord
}

async function pickRow(name: string) {
  const picks = await screen.findByRole('region', { name: strings.direction.picksTitle })
  return within(picks).findByRole<HTMLInputElement>('checkbox', { name: new RegExp(name) })
}

async function deviceRow(name: string) {
  const devices = await screen.findByRole('region', { name: strings.direction.devicesTitle })
  return within(devices).findByRole<HTMLInputElement>('checkbox', { name: new RegExp(name) })
}

function serveSide(state: World = {}) {
  mockServer({ plans: { c_ep1: [sided()] }, techniques: CARDS, ...state })
  renderBook(SCREEN)
}

test('the AI main devices come first and checked, then its sub answers, the rest folded', async () => {
  serveSide()
  const side = await screen.findByRole('complementary', { name: strings.direction.sideTitle })
  const boxes = within(side).getAllByRole('checkbox', { hidden: true })
  const first = boxes[0] as HTMLInputElement
  const second = boxes[1] as HTMLInputElement
  expect(first.closest('label')?.textContent).toContain(DEVICES.overhear.name)
  expect(first.closest('label')?.textContent).toContain(DEVICES.overhear.question)
  expect(first.closest('label')?.textContent).toContain(strings.direction.aiTag)
  expect(first.checked).toBe(true)
  expect(second.closest('label')?.textContent).toContain(DEVICES.knowledge_gap.name)
  expect(second.closest('label')?.textContent).toContain(strings.direction.subTag)
  expect(second.checked).toBe(false)
  expect(within(side).getByText(strings.direction.otherDevices(39))).toBeTruthy()
})

test('checking a device saves the list and shows the recommendations that come back', async () => {
  const after = sided({
    devices: ['overhear', 'knowledge_gap'],
    recommended: [{ rank: 1, technique: 'tech_x', devices: [], effects: [], situations: [] }],
  })
  serveSide({ afterDevices: after })
  fireEvent.click(await deviceRow(DEVICES.knowledge_gap.name))
  await pickRow('제타')
  expect(deviceSaves).toEqual([{ devices: ['overhear', 'knowledge_gap'] }])
  expect(screen.queryByRole('checkbox', { name: /알파/ })).toBeNull()
})

test('each check builds on the one before', async () => {
  serveSide()
  const gap = await deviceRow(DEVICES.knowledge_gap.name)
  const overhear = await deviceRow(DEVICES.overhear.name)
  fireEvent.click(gap)
  await waitFor(() => {
    expect(gap.checked).toBe(true)
  })
  fireEvent.click(overhear)
  await waitFor(() => {
    expect(deviceSaves).toEqual([
      { devices: ['overhear', 'knowledge_gap'] },
      { devices: ['knowledge_gap'] },
    ])
  })
})

test('the five recommendations come in rank order with the reason in words', async () => {
  serveSide()
  const first = await pickRow('알파')
  expect(first.closest('label')?.textContent).toContain(
    strings.direction.reason([DEVICES.overhear.name], ['긴장'], []),
  )
  const names = [...document.querySelectorAll('.direction-picks ol .pick-name')].map(
    (name) => name.textContent,
  )
  expect(names).toEqual(['1알파', '2베타', '3감마', '4델타', '5엡실론'])
})

test('keys 1-5 toggle cards and Enter sends them in the order picked', async () => {
  serveSide()
  await pickRow('엡실론')
  fireEvent.keyDown(window, { key: '5' })
  fireEvent.keyDown(window, { key: '1' })
  fireEvent.keyDown(window, { key: '2' })
  fireEvent.keyDown(window, { key: '2' })
  fireEvent.keyDown(window, { key: 'Enter' })
  await waitFor(() => {
    expect(picks).toEqual([{ techniques: ['tech_e', 'tech_a'] }])
  })
})

test('nothing is picked for the user and an empty pick cannot be sent', async () => {
  serveSide()
  await pickRow('알파')
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.direction.directScene }).disabled,
  ).toBe(true)
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(picks).toEqual([])
})

test('a fourth card is refused with the reason', async () => {
  serveSide()
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(await pickRow('베타'))
  fireEvent.click(await pickRow('델타'))
  fireEvent.click(await pickRow('엡실론'))
  expect((await screen.findByRole('alert')).textContent).toBe(strings.direction.tooManyCards(3))
  expect((await pickRow('엡실론')).checked).toBe(false)
})

test('three saved cards are the limit even if one of them cannot be read', async () => {
  mockServer({
    plans: { c_ep1: [sided({ chosen: ['tech_a', 'tech_b', 'tech_missing'] })] },
    techniques: CARDS,
  })
  renderBook(SCREEN)
  await screen.findByText('알파 예시')
  fireEvent.click(await pickRow('델타'))
  expect((await screen.findByRole('alert')).textContent).toBe(strings.direction.tooManyCards(3))
  expect((await pickRow('델타')).checked).toBe(false)
})

test('a conflicting card is refused with the reason', async () => {
  serveSide()
  await screen.findByText('알파 예시')
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(await pickRow('감마'))
  expect((await screen.findByRole('alert')).textContent).toBe(
    strings.direction.conflictCard('알파'),
  )
  expect((await pickRow('감마')).checked).toBe(false)
})

test('the catalog offers other scene cards, not serial or sentence-only ones', async () => {
  serveSide({
    catalog: [
      { id: 'tech_x', name: '제타', scope: ['장면'] },
      { id: 'tech_ser_019', name: '절단', scope: ['회차'] },
      { id: 'tech_rhe_001', name: '은유', scope: ['문장'] },
      { id: 'tech_a', name: '알파', scope: ['장면'] },
    ],
  })
  await pickRow('알파')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '제타' } })
  fireEvent.click(await screen.findByRole('button', { name: '제타' }))
  expect(screen.queryByRole('button', { name: '절단' })).toBeNull()
  expect(screen.queryByRole('button', { name: '은유' })).toBeNull()
  // It joins the picks, and can be taken off again.
  const added = await pickRow('제타')
  expect(added.checked).toBe(true)
  expect(added.closest('label')?.textContent).toContain(strings.direction.addedReason)
  fireEvent.click(added)
  expect(screen.queryByRole('checkbox', { name: /제타/ })).toBeNull()
})

test('typing a digit in the search does not pick a card', async () => {
  serveSide()
  await pickRow('알파')
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: '1' })
  expect((await pickRow('알파')).checked).toBe(false)
})

test('the evidence shows the reason, the card and its example', async () => {
  serveSide()
  const row = await pickRow('알파')
  fireEvent.mouseEnter(row.closest('label') as HTMLElement)
  const evidence = await screen.findByRole('region', { name: strings.direction.evidenceTitle })
  await within(evidence).findByText('알파 예시')
  expect(within(evidence).getByText('알파 설명')).toBeTruthy()
  expect(
    within(evidence).getByText(strings.direction.reason([DEVICES.overhear.name], ['긴장'], [])),
  ).toBeTruthy()
})

test('saved cards say so; a refusal on saving says why', async () => {
  serveSide({ refusePick: 'TECHNIQUES_CONFLICT' })
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.directScene }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    strings.direction.errors.TECHNIQUES_CONFLICT,
  )
})

test('once locked the devices and cards are read-only, keys included', async () => {
  serveSide({ work: { ...WORK, stage: 3, locked_stage: 2 } })
  const first = await pickRow('알파')
  expect(first.disabled).toBe(true)
  expect((await deviceRow(DEVICES.overhear.name)).disabled).toBe(true)
  fireEvent.keyDown(window, { key: '1' })
  expect(first.checked).toBe(false)
  expect(screen.queryByRole('searchbox')).toBeNull()
})

const BEATS = [
  {
    order: 1,
    summary: '첫 비트',
    techniques: ['tech_a'],
    pov: '테오 1인칭',
    mode: '장면화',
    focus: '감정',
    density: '자세히',
    tension: 3,
    target_chars: 2500,
  },
  {
    order: 2,
    summary: '둘째 비트',
    techniques: [],
    pov: '테오 1인칭',
    mode: '요약',
    focus: '정보',
    density: '담백',
    tension: 4,
    target_chars: 3000,
  },
]

const DIRECTED = { status: 'directed', beats: BEATS, chosen: ['tech_a'] }

async function saveBody() {
  await waitFor(() => {
    expect(beatSaves).toHaveLength(1)
  })
  return beatSaves[0]?.beats as { summary: string; tension: number; techniques: string[] }[]
}

test('the chosen cards are saved, then the scene is directed', async () => {
  serveSide()
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.directScene }))
  await waitFor(() => {
    expect(directs).toEqual(['/plans/pl_1/scenes/1/direct'])
  })
  expect(picks).toEqual([{ techniques: ['tech_a'] }])
})

test('while a scene is directed its progress shows and the cards are read-only', async () => {
  serveSide()
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.directScene }))
  await screen.findByText(strings.direction.directing)
  await waitFor(async () => {
    expect((await pickRow('베타')).disabled).toBe(true)
  })
})

test('a finished direction brings up the beats', async () => {
  serveSide({ directDone: sided(DIRECTED) })
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.directScene }))
  expect(await screen.findByDisplayValue('첫 비트')).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.direction.confirmScene })).toBeTruthy()
})

test('a refused direction says why', async () => {
  serveSide({ refuseDirect: 'SCENE_NOT_READY' })
  fireEvent.click(await pickRow('알파'))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.directScene }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    strings.direction.errors.SCENE_NOT_READY,
  )
})

test('directing again asks first, because the beats go', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  await screen.findByDisplayValue('첫 비트')
  fireEvent.click(screen.getByRole('button', { name: strings.direction.redirect }))
  const dialog = await screen.findByRole('alertdialog')
  expect(directs).toEqual([])
  expect(document.activeElement?.textContent).toBe(strings.direction.cancel)
  fireEvent.click(within(dialog).getByRole('button', { name: strings.direction.redirect }))
  await waitFor(() => {
    expect(directs).toHaveLength(1)
  })
})

test('a changed beat is saved with the whole list, without its number', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue('첫 비트')
  fireEvent.change(summary, { target: { value: ' 고친 비트 ' } })
  fireEvent.blur(summary)
  const beats = await saveBody()
  expect(beats.map((beat) => beat.summary)).toEqual(['고친 비트', '둘째 비트'])
  expect(beats[0]).not.toHaveProperty('order')
})

test('a summary left blank goes back to what it was, nothing is saved', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue<HTMLTextAreaElement>('첫 비트')
  fireEvent.change(summary, { target: { value: '   ' } })
  fireEvent.blur(summary)
  expect(summary.value).toBe('첫 비트')
  expect(beatSaves).toEqual([])
})

test('a select saves at once', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  await screen.findByDisplayValue('첫 비트')
  const tension = screen.getAllByRole('combobox', { name: strings.direction.beatTension })[1]
  fireEvent.change(tension as HTMLElement, { target: { value: '5' } })
  expect((await saveBody())[1]?.tension).toBe(5)
})

test('a beat names only its scene cards and the serial ones of its place', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  await screen.findByDisplayValue('첫 비트')
  const groups = screen.getAllByRole('group', { name: strings.direction.beatCards })
  const buttons = within(groups[0] as HTMLElement).getAllByRole('button')
  // The only scene of its chapter: tech_a, then all four serial cards.
  expect(buttons).toHaveLength(5)
  fireEvent.click(buttons[0] as HTMLElement)
  expect((await saveBody())[0]?.techniques).toEqual([])
})

test('dragging a beat by its handle reorders the list', async () => {
  mockServer({ plans: { c_ep1: [sided(DIRECTED)] }, techniques: CARDS })
  renderBook(SCREEN)
  await screen.findByDisplayValue('첫 비트')
  const list = screen.getByRole('list', { name: strings.direction.beatsTitle })
  const rows = [...list.children] as HTMLElement[]
  rows.forEach((row, at) => {
    row.getBoundingClientRect = () => ({ top: at * 100, height: 100 }) as DOMRect
  })
  const handle = screen.getByRole('separator', { name: strings.direction.beatHandle(1) })
  handle.setPointerCapture = () => undefined
  fireEvent.pointerDown(handle, { clientY: 50, button: 0, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientY: 190, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientY: 190, pointerId: 1 })
  expect((await saveBody()).map((beat) => beat.summary)).toEqual(['둘째 비트', '첫 비트'])
})

test('a directed scene is confirmed; a confirmed one says so', async () => {
  mockServer({
    plans: { c_ep1: [sided(DIRECTED)] },
    techniques: CARDS,
    afterConfirm: sided({ ...DIRECTED, status: 'confirmed' }),
  })
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.confirmScene }))
  await waitFor(() => {
    expect(confirms).toEqual(['/plans/pl_1/scenes/1/confirm'])
  })
  const done = await screen.findByRole<HTMLButtonElement>('button', {
    name: strings.direction.confirmed,
  })
  expect(done.disabled).toBe(true)
})

test('a stale scene cannot be confirmed and says why', async () => {
  mockServer({ plans: { c_ep1: [sided({ ...DIRECTED, status: 'stale' })] }, techniques: CARDS })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.confirmStale)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.direction.confirmScene })
      .disabled,
  ).toBe(true)
})

test('while the scene is directed its beats cannot be edited or confirmed', async () => {
  mockServer({
    plans: { c_ep1: [sided(DIRECTED)] },
    techniques: CARDS,
    jobs: [job('running', { jobId: 'job_2', kind: 'direct', key: 'direct:pl_1:1' })],
  })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue<HTMLTextAreaElement>('첫 비트')
  await waitFor(() => {
    expect(summary.disabled).toBe(true)
  })
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.direction.confirmScene })
      .disabled,
  ).toBe(true)
  expect(screen.queryByRole('separator', { name: strings.direction.beatHandle(1) })).toBeNull()
})

test('a beat save refused says why', async () => {
  mockServer({
    plans: { c_ep1: [sided(DIRECTED)] },
    techniques: CARDS,
    refuseBeats: 'BEATS_INVALID',
  })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue('첫 비트')
  fireEvent.change(summary, { target: { value: '고침' } })
  fireEvent.blur(summary)
  expect((await screen.findByRole('alert')).textContent).toContain(
    strings.direction.errors.BEATS_INVALID,
  )
})

test('a stale beat naming a card its place no longer allows is saved without it', async () => {
  const beats = [{ ...BEATS[0], techniques: ['tech_a', 'tech_old'] }, BEATS[1]]
  mockServer({
    plans: { c_ep1: [sided({ ...DIRECTED, status: 'stale', beats })] },
    techniques: CARDS,
  })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue('첫 비트')
  fireEvent.change(summary, { target: { value: '고침' } })
  fireEvent.blur(summary)
  expect((await saveBody())[0]?.techniques).toEqual(['tech_a'])
})

test('directing again clears an earlier save failure', async () => {
  mockServer({
    plans: { c_ep1: [sided(DIRECTED)] },
    techniques: CARDS,
    refuseBeats: 'BEATS_INVALID',
  })
  renderBook(SCREEN)
  const summary = await screen.findByDisplayValue('첫 비트')
  fireEvent.change(summary, { target: { value: '고침' } })
  fireEvent.blur(summary)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: strings.direction.redirect }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: strings.direction.redirect }))
  await screen.findByText(strings.direction.directing)
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

test('the planning can be looked at, read-only, from the direction page', async () => {
  mockServer({})
  renderBook(SCREEN)
  fireEvent.click(await screen.findByRole('button', { name: strings.direction.viewPlanning }))
  expect(useNavigation.getState().screen).toMatchObject({ name: 'story', workId: 'w_1' })
})

test('writing starts only once every active episode is confirmed', async () => {
  mockServer({ plans: { c_ep1: [{ ...RECORD, status: 'confirmed' }] } })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.writingProgress(1, 2))
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: strings.direction.startWriting })
      .disabled,
  ).toBe(true)
})

test('all confirmed, writing starts after the lock warning, then the contents', async () => {
  const confirmed = (episode_id: string) =>
    ({ ...RECORD, id: `pl_${episode_id}`, episode_id, status: 'confirmed' }) as PlanRecord
  mockServer({ plans: { c_ep1: [confirmed('c_ep1')], c_ep2: [confirmed('c_ep2')] } })
  renderBook(SCREEN)
  await screen.findByText(strings.direction.writingProgress(2, 2))
  fireEvent.click(screen.getByRole('button', { name: strings.direction.startWriting }))
  const dialog = await screen.findByRole('alertdialog', { name: strings.stageLock.writeTitle })
  await within(dialog).findByText(strings.stageLock.writeLock)
  expect(document.activeElement?.textContent).toBe(strings.stageLock.cancel)
  const start = within(dialog).getByRole<HTMLButtonElement>('button', {
    name: strings.stageLock.writeStart,
  })
  await waitFor(() => {
    expect(start.disabled).toBe(false)
  })
  expect(start.hasAttribute('data-danger')).toBe(true)
  fireEvent.click(start)
  await waitFor(() => {
    expect(useNavigation.getState().screen).toMatchObject({ name: 'contents', workId: 'w_1' })
  })
  expect(calls).toContainEqual({ method: 'POST', path: '/works/w_1/stage/advance' })
})

test('once writing has started there is no button to start it', async () => {
  mockServer({ work: { ...WORK, stage: 3, locked_stage: 2 } })
  renderBook(SCREEN)
  await screen.findByRole('button', { name: strings.direction.viewPlanning })
  expect(screen.queryByRole('button', { name: strings.direction.startWriting })).toBeNull()
})

test('Enter on a scene just clicked in the timeline directs it', async () => {
  serveSide()
  fireEvent.click(await pickRow('알파'))
  const timeline = screen.getByRole('group', { name: strings.direction.timeline })
  const scene = timeline.querySelector<HTMLElement>('.timeline-scene') as HTMLElement
  scene.focus()
  fireEvent.keyDown(scene, { key: 'Enter' })
  await waitFor(() => {
    expect(directs).toHaveLength(1)
  })
})
