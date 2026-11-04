import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { CardDrawer, type DrawerRequest } from '../src/components/CardDrawer'
import { display } from '../src/components/cardFields'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { CharacterCard, CharacterCardOutput, Draft } from '../src/types'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}
const NOTES = '테오는 북부 항구 출신이다. 말수가 적다.'

function output(overrides: Partial<CharacterCardOutput> = {}): CharacterCardOutput {
  return {
    type: 'character',
    name: '테오',
    data: {
      theme: '잃어버린 가족을 찾는 귀환자',
      personality: { traits: ['과묵함'], behaviors: [] },
      speech: { description: '짧은 반말', examples: ['됐어.', '가자.', '아니야.'] },
      appearance: { summary: null, details: null },
      relations: [{ target_id: 'c_mira', relation: '소꿉친구' }],
      origin_region_id: 'c_port',
    },
    evidence: { theme: [1], name: [0] },
    ai_guess: [],
    ...overrides,
  }
}

type Call = { method: string; path: string; body: unknown }

function sse(events: [string, unknown][]): Response {
  const text = events.map(([n, d]) => `id: 1\nevent: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
}

function serve(
  options: {
    generated?: CharacterCardOutput
    saveError?: string
    jobError?: string
    dropStream?: boolean
    // From this generation on (1 = the first), the job's stream stays open until cancelled.
    holdJobFrom?: number
    // A chat turn's stream stays open.
    holdTurn?: boolean
  } = {},
) {
  let generations = 0
  const open: ReadableStreamDefaultController<Uint8Array>[] = []
  const held = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          open.push(controller)
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  let draft: Draft = {
    id: 'dr_1',
    work_id: 'w_1',
    type: 'character',
    card_id: null,
    category: null,
    part_id: null,
    notes: NOTES,
    sentences: ['테오는 북부 항구 출신이다.', '말수가 적다.'],
    turns: [{ role: 'ai', text: '누구인가요?' }],
    pinned: [],
    generated: null,
  }
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ method, path, body })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (method === 'POST' && path === '/works/w_1/drafts') {
        draft = { ...draft, card_id: (body as { card_id?: string }).card_id ?? null }
        return json(draft, 201)
      }
      if (method === 'GET' && path === '/drafts/dr_1') return json(draft)
      if (method === 'PUT' && path === '/drafts/dr_1/source') {
        const notes = (body as { notes: string }).notes
        draft = { ...draft, notes, sentences: [notes] }
        return json(draft)
      }
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      if (path === '/drafts/dr_1/messages') {
        return Promise.resolve(options.holdTurn ? held() : sse([['done', {}]]))
      }
      if (method === 'POST' && path === '/jobs/job_1/cancel') {
        for (const controller of open.splice(0)) {
          controller.enqueue(new TextEncoder().encode('id: 2\nevent: cancelled\ndata: {}\n\n'))
          controller.close()
        }
        return json({ id: 'job_1' })
      }
      if (path === '/drafts/dr_1/generate') {
        generations += 1
        // A held job (cancelled later) brings no card back.
        const holds = options.holdJobFrom !== undefined && generations >= options.holdJobFrom
        if (!holds) draft = { ...draft, generated: options.generated ?? output() }
        return json({ jobId: 'job_1' }, 202)
      }
      if (path.startsWith('/jobs/job_1/events')) {
        if (options.holdJobFrom !== undefined && generations >= options.holdJobFrom) {
          return Promise.resolve(held())
        }
        if (options.dropStream) return Promise.resolve(sse([['progress', { done: 0, total: 1 }]]))
        return Promise.resolve(
          sse(
            options.jobError
              ? [['error', { code: options.jobError, message: 'x' }]]
              : [['done', { result: {} }]],
          ),
        )
      }
      if (path === '/drafts/dr_1/save') {
        if (options.saveError)
          return json({ code: options.saveError, message: 'x', hint: null }, 409)
        return json({ id: 'c_new', name: '테오' })
      }
      if (path === '/cards/c_teo') return json(saved())
      if (path === '/cards/c_teo/references') {
        return json({
          references: [{ card_id: 'c_ep1', type: 'episode', name: '1화', field: 'characters' }],
        })
      }
      if (path.startsWith('/works/w_1/cards')) {
        return json({
          cards: [
            { id: 'c_mira', type: 'character', name: '미라' },
            { id: 'c_port', type: 'region', name: '북부 항구' },
          ],
        })
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

function saved(): CharacterCard {
  const card = output({ name: '테오도르' })
  return {
    ...card,
    id: 'c_teo',
    work_id: 'w_1',
    status: 'complete',
    source_notes: NOTES,
    pinned: [],
    schema_version: 1,
    data: { ...card.data, theme: '옛 주제' },
  }
}

function renderDrawer(request: DrawerRequest = { workId: 'w_1', type: 'character' }) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <CardDrawer request={request} onClose={onClose} onSaved={onSaved} />
      </QueryClientProvider>
    </StrictMode>,
  )
  return { onClose, onSaved, client, unmount: view.unmount }
}

async function generated(): Promise<void> {
  const button = await screen.findByRole('button', { name: strings.preview.generate })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  fireEvent.click(button)
  await screen.findByRole('button', { name: strings.preview.save })
}

beforeEach(() => {
  useServer.setState({ state: READY })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a generated card reads field by field with its evidence', async () => {
  serve()
  renderDrawer()
  await generated()
  const field = (label: string) =>
    screen.getByRole('button', { name: label }).closest('.preview-field') as HTMLElement
  expect(within(field('주제')).getByText('잃어버린 가족을 찾는 귀환자')).toBeTruthy()
  // Ids read as names; no evidence reads as AI 추정; an empty required field says so.
  expect(within(field('관계')).getByText('미라 — 소꿉친구')).toBeTruthy()
  expect(within(field('출신 지역')).getByText('북부 항구')).toBeTruthy()
  expect(within(field('성격 특성')).getByText(strings.preview.guessed)).toBeTruthy()
  expect(within(field('주제')).queryByText(strings.preview.guessed)).toBeNull()
  expect(within(field('외모')).getByText(strings.preview.undecided)).toBeTruthy()
  // The field's evidence is marked in the notes.
  fireEvent.click(screen.getByRole('button', { name: '주제' }))
  const sentence = screen.getByText('말수가 적다.').closest('li')
  expect(sentence?.hasAttribute('data-evidence')).toBe(true)
  expect(screen.getByRole('dialog', { name: '테오' })).toBeTruthy()
})

test('pinned fields go with the next generation', async () => {
  const { calls } = serve()
  renderDrawer()
  await generated()
  fireEvent.click(screen.getByRole('button', { name: strings.preview.pin('말투') }))
  expect(screen.getByRole('button', { name: strings.preview.pin('말투') })).toHaveProperty(
    'ariaPressed',
    'true',
  )
  fireEvent.click(screen.getByRole('button', { name: strings.preview.regenerate }))
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/generate').at(-1)?.body).toEqual({
      pinned: ['speech.description'],
    })
  })
})

test('save closes the drawer and hands the card over', async () => {
  const { calls } = serve()
  const { onClose, onSaved } = renderDrawer()
  await generated()
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce()
  })
  expect(onSaved).toHaveBeenCalledWith({ id: 'c_new', name: '테오' })
  expect(calls.some((c) => c.method === 'POST' && c.path === '/drafts/dr_1/save')).toBe(true)
})

test('a stale card asks to generate again', async () => {
  serve({ saveError: 'CARD_STALE' })
  const { onClose } = renderDrawer()
  await generated()
  fireEvent.click(screen.getByRole('button', { name: strings.preview.save }))
  expect(await screen.findByText(strings.preview.stale)).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

test('closing with an unsaved card asks first', async () => {
  serve()
  const { onClose } = renderDrawer()
  await generated()
  fireEvent.keyDown(window, { key: 'Escape' })
  const ask = screen.getByRole('alertdialog', { name: strings.preview.unsavedTitle })
  // The safe choice has focus; discarding is red and never the default.
  expect(document.activeElement).toBe(
    within(ask).getByRole('button', { name: strings.preview.keep }),
  )
  fireEvent.keyDown(ask, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.close }))
  fireEvent.click(screen.getByRole('button', { name: strings.preview.discard }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('a failed generation says why', async () => {
  serve({ jobError: 'LLM_UNAVAILABLE' })
  renderDrawer()
  const button = await screen.findByRole('button', { name: strings.preview.generate })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
})

test('editing shows only what changed, with the old value struck', async () => {
  serve()
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await generated()
  const fields = screen
    .getAllByRole('button', { name: /./ })
    .filter((b) => b.className === 'preview-name')
  // Name and theme changed; appearance is still missing; the rest is as saved.
  expect(fields.map((b) => b.textContent)).toEqual(['이름', '주제', '외모'])
  const theme = screen
    .getByRole('button', { name: '주제' })
    .closest('.preview-field') as HTMLElement
  expect(within(theme).getByText('옛 주제').tagName).toBe('DEL')
  // The new name: the cards that point at this one are listed before saving (§8).
  expect(await screen.findByText(strings.preview.references)).toBeTruthy()
  expect(screen.getByText('1화')).toBeTruthy()
})

test('changed relations list the characters gaining or losing one, not the cards pointing here (§8)', async () => {
  const base = output({ name: '테오도르' })
  const { calls } = serve({ generated: { ...base, data: { ...base.data, relations: [] } } })
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await generated()
  expect(await screen.findByText(strings.preview.ties)).toBeTruthy()
  expect(screen.getByText(strings.preview.tiesNote.character)).toBeTruthy()
  expect(screen.getByText(strings.preview.tie.removed, { exact: false })).toBeTruthy()
  expect(screen.queryByText(strings.preview.references)).toBeNull()
  expect(screen.queryByText('1화')).toBeNull()
  expect(calls.some((c) => c.path === '/cards/c_teo/references')).toBe(false)
})

test('a structure reads as its stage count, then a stage per line', () => {
  const structure = {
    type: 4,
    stages: [
      { name: '기', summary: '테오가 돌아온다', tension: 1 },
      { name: '승', summary: null, tension: 2 },
    ],
  }
  expect(display(structure, new Map())).toBe(
    `${strings.typeSection.stages(4)}\n기: 테오가 돌아온다\n승: —`,
  )
})

test('the same name, relations and characters list nothing', async () => {
  const { calls } = serve({ generated: output({ name: '테오도르' }) })
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await generated()
  expect(screen.queryByText(strings.preview.references)).toBeNull()
  expect(screen.queryByText(strings.preview.ties)).toBeNull()
  expect(calls.some((c) => c.path === '/cards/c_teo/references')).toBe(false)
})

test('a stream that ends without a result is a failed generation', async () => {
  serve({ dropStream: true })
  renderDrawer()
  const button = await screen.findByRole('button', { name: strings.preview.generate })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  fireEvent.click(button)
  expect(await screen.findByText(strings.preview.generateFailed)).toBeTruthy()
})

test('notes changed after generation make the card stale', async () => {
  const { calls } = serve()
  renderDrawer()
  await generated()
  fireEvent.click(screen.getByRole('button', { name: '주제' }))
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.editNotes }))
  // Typing in the notes: Ctrl+S never saves (nor closes) over unsaved text.
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  expect(calls.some((c) => c.path === '/drafts/dr_1/save')).toBe(false)
  fireEvent.change(screen.getByLabelText(strings.drawer.editNotesLabel), {
    target: { value: '테오는 활을 쓴다.' },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.saveNotes }))
  expect(await screen.findByText(strings.preview.stale)).toBeTruthy()
  expect(screen.getByRole('button', { name: strings.preview.save })).toHaveProperty(
    'disabled',
    true,
  )
  // The old evidence would point at the wrong sentence: no highlight.
  expect(document.querySelector('[data-evidence]')).toBeNull()
})

test('a double Ctrl+S saves once', async () => {
  const { calls } = serve()
  const { onClose } = renderDrawer()
  await generated()
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce()
  })
  expect(calls.filter((c) => c.path === '/drafts/dr_1/save')).toHaveLength(1)
})

test('a saved draft leaves nothing in the cache once the drawer goes', async () => {
  const { calls } = serve()
  const { onClose, client, unmount } = renderDrawer()
  await generated()
  expect(client.getQueryData(['draft', 'dr_1'])).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: strings.preview.save }))
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledOnce()
  })
  // The parent takes the drawer away.
  unmount()
  expect(client.getQueryData(['draft', 'dr_1'])).toBeUndefined()
  // Saving closed the draft on the server: nothing to delete.
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/drafts/dr_1')).toBe(false)
})

test('a regeneration that changed nothing says so', async () => {
  const base = output({ name: '테오도르' })
  serve({ generated: { ...base, data: { ...base.data, theme: '옛 주제' } } })
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await generated()
  expect(screen.getByText(strings.preview.unchanged)).toBeTruthy()
  // The missing required field still shows, so it can be filled in.
  expect(
    screen
      .getAllByRole('button', { name: /./ })
      .filter((b) => b.className === 'preview-name')
      .map((b) => b.textContent),
  ).toEqual(['외모'])
})

test('a changed card does not say nothing changed', async () => {
  serve()
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await generated()
  expect(screen.queryByText(strings.preview.unchanged)).toBeNull()
})

test('a long generation can be cancelled; nothing reads as a failure', async () => {
  const { calls } = serve({ holdJobFrom: 1 })
  renderDrawer()
  const button = await screen.findByRole('button', { name: strings.preview.generate })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  // Only the elapsed-seconds clock is faked (waitFor polls with intervals: none in between).
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    fireEvent.click(button)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls.some((c) => c.path.startsWith('/jobs/job_1/events'))).toBe(true)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
  } finally {
    vi.useRealTimers()
  }
  expect(screen.getByText(strings.preview.elapsed(10))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: strings.preview.cancel }))
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'POST' && c.path === '/jobs/job_1/cancel')).toBe(true)
  })
  await waitFor(() => {
    expect(screen.queryByText(strings.preview.generating)).toBeNull()
  })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: strings.preview.generate })).toHaveProperty(
    'disabled',
    false,
  )
})

test('save is refused while a generation runs', async () => {
  const { calls } = serve({ holdJobFrom: 2 })
  const { onClose } = renderDrawer()
  await generated()
  fireEvent.click(screen.getByRole('button', { name: strings.preview.regenerate }))
  await waitFor(() => {
    expect(calls.filter((c) => c.path.startsWith('/jobs/job_1/events'))).toHaveLength(2)
  })
  expect(screen.getByRole('button', { name: strings.preview.save })).toHaveProperty(
    'disabled',
    true,
  )
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls.some((c) => c.path === '/drafts/dr_1/save')).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
})

test('save is refused while a chat turn runs', async () => {
  const { calls } = serve({ holdTurn: true })
  const { onClose } = renderDrawer()
  await generated()
  const input = screen.getByLabelText(strings.drawer.inputLabel)
  fireEvent.change(input, { target: { value: '테오는 활을 쓴다.' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    expect(calls.some((c) => c.path === '/drafts/dr_1/messages')).toBe(true)
  })
  expect(screen.getByRole('button', { name: strings.preview.save })).toHaveProperty(
    'disabled',
    true,
  )
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls.some((c) => c.path === '/drafts/dr_1/save')).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
})
