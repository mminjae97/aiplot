import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { CardDrawer, type DrawerRequest } from '../src/components/CardDrawer'
import { useNavigation } from '../src/stores/navigation'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type {
  Card,
  CardOutput,
  CharacterData,
  Draft,
  FiveStageStructure,
  FourStageStructure,
  Work,
} from '../src/types'
import { renderBook } from './bookHarness'
import { NO_DIALOGS } from './serverFixtures'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}
const REPLY = '테오는 어떤 사람인가요?'

type Call = { method: string; path: string; body: unknown }

function sse(events: [string, unknown][]): Response {
  const text = events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
}

function baseDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'dr_1',
    work_id: 'w_1',
    type: 'character',
    card_id: null,
    category: null,
    part_id: null,
    notes: '',
    sentences: [],
    turns: [],
    pinned: [],
    generated: null,
    ...overrides,
  }
}

/** The drafts API in memory; each turn answers with the events given for it. */
function serve(turnEvents: (text: string) => [string, unknown][]) {
  let draft = baseDraft()
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
        draft = baseDraft(body as Partial<Draft>)
        return json(draft, 201)
      }
      if (method === 'GET' && path === '/drafts/dr_1') return json(draft)
      if (method === 'DELETE' && path === '/drafts/dr_1')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (method === 'PUT' && path === '/drafts/dr_1/source') {
        const notes = (body as { notes: string }).notes
        draft = { ...draft, notes, sentences: notes ? notes.split(/(?<=\.)\s+/) : [] }
        return json(draft)
      }
      if (method === 'POST' && path === '/drafts/dr_1/messages') {
        const text = (body as { text: string }).text
        const events = turnEvents(text)
        const reply = events
          .filter(([n]) => n === 'reply')
          .map(([, d]) => (d as { text: string }).text)
          .join('')
        draft = {
          ...draft,
          turns: [
            ...draft.turns,
            ...(text ? [{ role: 'user' as const, text }] : []),
            { role: 'ai', text: reply },
          ],
        }
        for (const [name, data] of events) {
          if (name === 'source') {
            const update = data as { notes: string; sentences: string[] }
            draft = { ...draft, notes: update.notes, sentences: update.sentences }
          }
        }
        return Promise.resolve(sse(events))
      }
      if (path.startsWith('/works/w_1/cards?type=')) return json({ cards: [] })
      if (path.startsWith('/works/w_1/cards')) {
        return json({
          cards: [
            { id: 'c_leo', type: 'character', name: '레오' },
            { id: 'c_lemon', type: 'region', name: '레몬 숲' },
          ],
        })
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

const SOURCE = {
  notes: '테오는 북부 항구 출신이다.',
  sentences: ['테오는 북부 항구 출신이다.'],
  changed: [0],
  questions: ['몇 살인가요?'],
  similar_names: [{ mentioned: '래오', similar_to: '레오', card_id: 'c_leo' }],
}

function turnOf(text: string): [string, unknown][] {
  if (!text)
    return [
      ['reply', { text: '테오는 ' }],
      ['reply', { text: '어떤 사람인가요?' }],
      ['done', {}],
    ]
  return [
    ['reply', { text: '알겠어요.' }],
    ['replied', { text: '알겠어요.' }],
    ['source', SOURCE],
    ['done', {}],
  ]
}

/** The editor opens once the running turn is over (the button waits for it). */
async function editButton(): Promise<HTMLElement> {
  const button = screen.getByRole('button', { name: strings.drawer.editNotes })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  return button
}

function renderDrawer(request: DrawerRequest = { workId: 'w_1', type: 'character' }) {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // StrictMode, as the app runs: effects run twice, the drawer still opens one draft.
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <CardDrawer request={request} onClose={onClose} />
      </QueryClientProvider>
    </StrictMode>,
  )
  return { onClose, unmount: view.unmount }
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a new card opens with the AI asking first', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  expect(await screen.findByText(REPLY)).toBeTruthy()
  const dialog = screen.getByRole('dialog', { name: strings.drawer.untitled })
  expect(
    within(dialog).getByText(`${strings.drawer.kind.character} · ${strings.drawer.new}`),
  ).toBeTruthy()
  expect(calls.filter((c) => c.method === 'POST' && c.path === '/works/w_1/drafts')).toHaveLength(1)
  expect(
    calls.filter((c) => c.method === 'POST' && c.path === '/drafts/dr_1/messages'),
  ).toHaveLength(1)
  expect(calls.find((c) => c.path === '/drafts/dr_1/messages')?.body).toEqual({
    text: '',
    refs: [],
  })
  expect(screen.getByText(strings.drawer.notesEmpty)).toBeTruthy()
})

test('a turn updates the notes, highlights what changed and asks', async () => {
  serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(screen.getByLabelText(strings.drawer.inputLabel), {
    target: { value: '테오는 북부 항구 출신이야.' },
  })
  fireEvent.keyDown(screen.getByLabelText(strings.drawer.inputLabel), { key: 'Enter' })
  const sentence = await screen.findByText('테오는 북부 항구 출신이다.', { exact: false })
  expect(sentence.closest('li')?.hasAttribute('data-changed')).toBe(true)
  expect(screen.getByText('몇 살인가요?')).toBeTruthy()
  expect(await screen.findByText('알겠어요.')).toBeTruthy()
  expect(screen.getByText('테오는 북부 항구 출신이야.')).toBeTruthy()
  expect(screen.getByLabelText<HTMLTextAreaElement>(strings.drawer.inputLabel).value).toBe('')
})

test('similar names: same sends a turn, different dismisses', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  const input = screen.getByLabelText(strings.drawer.inputLabel)
  fireEvent.change(input, { target: { value: '래오는 친구야.' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  const prompt = await screen.findByText(strings.drawer.sameName('래오', '레오'))
  fireEvent.click(
    within(prompt.parentElement as HTMLElement).getByRole('button', { name: strings.drawer.same }),
  )
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
      text: strings.drawer.sameMessage('래오', '레오'),
      refs: ['c_leo'],
    })
  })
  const again = await screen.findByText(strings.drawer.sameName('래오', '레오'))
  fireEvent.click(
    within(again.parentElement as HTMLElement).getByRole('button', {
      name: strings.drawer.different,
    }),
  )
  expect(screen.queryByText(strings.drawer.sameName('래오', '레오'))).toBeNull()
})

test('@ picks a card and mentions it in the turn', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  const input = screen.getByLabelText<HTMLTextAreaElement>(strings.drawer.inputLabel)
  fireEvent.change(input, { target: { value: '친구는 @레', selectionStart: 7 } })
  input.setSelectionRange(7, 7)
  fireEvent.change(input, { target: { value: '친구는 @레' } })
  const options = await screen.findAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['레오캐릭터', '레몬 숲지역'])
  expect(calls.some((c) => c.path === `/works/w_1/cards?q=${encodeURIComponent('레')}`)).toBe(true)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input.value).toBe('친구는 @레오 ')
  fireEvent.change(input, { target: { value: '친구는 @레오 이다.' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
      text: '친구는 @레오 이다.',
      refs: ['c_leo'],
    })
  })
})

test('the notes can be edited directly', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.click(await editButton())
  fireEvent.change(screen.getByLabelText(strings.drawer.editNotesLabel), {
    target: { value: '테오는 활을 쓴다. 말수가 적다.' },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.saveNotes }))
  expect(await screen.findByText('말수가 적다.')).toBeTruthy()
  expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
    notes: '테오는 활을 쓴다. 말수가 적다.',
  })
})

test('an error says why and the conversation goes on', async () => {
  serve((text) =>
    text
      ? [
          ['error', { code: 'LLM_UNAVAILABLE', message: 'x' }],
          ['done', {}],
        ]
      : turnOf(text),
  )
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(screen.getByLabelText(strings.drawer.inputLabel), { target: { value: '안녕.' } })
  fireEvent.keyDown(screen.getByLabelText(strings.drawer.inputLabel), { key: 'Enter' })
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
  // The drawer is ready for the next turn.
  fireEvent.change(screen.getByLabelText(strings.drawer.inputLabel), { target: { value: '다시.' } })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: strings.drawer.send })).toHaveProperty(
      'disabled',
      false,
    )
  })
})

test('closing forgets the draft on the server', async () => {
  const { calls } = serve(turnOf)
  const { onClose, unmount } = renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  // The screen takes the drawer away on close; that is when the draft goes.
  unmount()
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/drafts/dr_1')).toBe(true)
  })
})

test('editing a card opens without the AI speaking first', async () => {
  const { calls } = serve(turnOf)
  renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  expect(
    await screen.findByText(`${strings.drawer.kind.character} · ${strings.drawer.edit}`),
  ).toBeTruthy()
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'GET' && c.path === '/drafts/dr_1')).toBe(true)
  })
  expect(calls.some((c) => c.path === '/drafts/dr_1/messages')).toBe(false)
})

test('the contents page opens each planning item screen', async () => {
  serve(turnOf)
  const work: Work = {
    id: 'w_1',
    title: '책',
    stage: 1,
    locked_stage: 0,
    last_item: null,
    color: null,
    cover_id: null,
    updated_at: '2026-10-31T00:00:00.000Z',
  }
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/works/w_1')
        ? Promise.resolve(new Response(JSON.stringify(work)))
        : base(url, init),
    ),
  )
  renderBook({ name: 'contents', workId: 'w_1' })
  for (const [item, name] of [
    ['세계관', 'world'],
    ['캐릭터', 'characters'],
    ['지역', 'regions'],
    ['스토리', 'story'],
  ] as const) {
    fireEvent.click(await screen.findByRole('button', { name: item }))
    expect(useNavigation.getState().screen).toEqual({ name, workId: 'w_1' })
  }
})

test('Esc leaves the notes editor, never the drawer with unsaved text', async () => {
  serve(turnOf)
  const { onClose } = renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.click(await editButton())
  const editor = screen.getByLabelText(strings.drawer.editNotesLabel)
  // While editing by hand, the chat waits (a turn would rewrite the notes underneath).
  expect(screen.getByRole('button', { name: strings.drawer.send })).toHaveProperty('disabled', true)
  fireEvent.change(editor, { target: { value: '고치는 중이다.' } })
  fireEvent.keyDown(editor, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.mouseDown(document.querySelector('.drawer-backdrop') as Element)
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText<HTMLTextAreaElement>(strings.drawer.editNotesLabel).value).toBe(
    '고치는 중이다.',
  )
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.cancelNotes }))
  // An untouched editor goes with Esc.
  fireEvent.click(await editButton())
  fireEvent.keyDown(screen.getByLabelText(strings.drawer.editNotesLabel), { key: 'Escape' })
  expect(screen.queryByLabelText(strings.drawer.editNotesLabel)).toBeNull()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

test('leaving the screen without closing still forgets the draft', async () => {
  const { calls } = serve(turnOf)
  const { unmount } = renderDrawer()
  await screen.findByText(REPLY)
  unmount()
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/drafts/dr_1')).toBe(true)
  })
})

test('a drawer gone before its draft exists deletes it when it arrives', async () => {
  const { calls } = serve(turnOf)
  const { unmount } = renderDrawer()
  unmount()
  await waitFor(() => {
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/drafts/dr_1')).toBe(true)
  })
  // Nobody is there to hear the AI's opening.
  expect(calls.some((c) => c.path === '/drafts/dr_1/messages')).toBe(false)
})

test('a mention counts only as the whole @name', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  const input = screen.getByLabelText<HTMLTextAreaElement>(strings.drawer.inputLabel)
  input.setSelectionRange(0, 0)
  fireEvent.change(input, { target: { value: '@레' } })
  await screen.findAllByRole('option')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.change(input, { target: { value: '@레오나와 만난다.' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
      text: '@레오나와 만난다.',
      refs: [],
    })
  })
})

/** Answers some paths itself, the rest as `serve` does. */
function route(answer: (method: string, path: string) => unknown) {
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const data = answer(init.method ?? 'GET', path)
      return data === undefined
        ? base(url, init)
        : Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
    }),
  )
}

const chatInput = () => screen.getByLabelText<HTMLTextAreaElement>(strings.drawer.inputLabel)

/** Picks 레오 from the @ list into an empty input. */
async function mentionLeo(): Promise<void> {
  chatInput().setSelectionRange(0, 0)
  fireEvent.change(chatInput(), { target: { value: '@레' } })
  await screen.findAllByRole('option')
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
}

const FAILED_TURN: [string, unknown][] = [
  ['error', { code: 'LLM_UNAVAILABLE', message: 'x' }],
  ['done', {}],
]

test('a mention counts with a particle after the name', async () => {
  const { calls } = serve(turnOf)
  renderDrawer()
  await screen.findByText(REPLY)
  await mentionLeo()
  fireEvent.change(chatInput(), { target: { value: '@레오가 검을 들었다.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
      text: '@레오가 검을 들었다.',
      refs: ['c_leo'],
    })
  })
})

test('a failed turn gives its words and mentions back to the input', async () => {
  let fail = true
  const { calls } = serve((text) => (text && fail ? FAILED_TURN : turnOf(text)))
  renderDrawer()
  await screen.findByText(REPLY)
  await mentionLeo()
  fireEvent.change(chatInput(), { target: { value: '@레오가 왔다.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
  await waitFor(() => {
    expect(chatInput().value).toBe('@레오가 왔다.')
  })
  // Sent again once the AI is back: the mention still goes with it.
  fail = false
  await waitFor(() => {
    expect(screen.getByRole('button', { name: strings.drawer.send })).toHaveProperty(
      'disabled',
      false,
    )
  })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  await waitFor(() => {
    expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
      text: '@레오가 왔다.',
      refs: ['c_leo'],
    })
  })
  await screen.findByText('알겠어요.')
  expect(chatInput().value).toBe('')
})

test('a same-name answer whose turn fails keeps the question', async () => {
  let fail = false
  const { calls } = serve((text) => (text && fail ? FAILED_TURN : turnOf(text)))
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(chatInput(), { target: { value: '래오는 친구야.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  const prompt = await screen.findByText(strings.drawer.sameName('래오', '레오'))
  fail = true
  fireEvent.click(
    within(prompt.parentElement as HTMLElement).getByRole('button', { name: strings.drawer.same }),
  )
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
  expect(calls.filter((c) => c.path === '/drafts/dr_1/messages').at(-1)?.body).toEqual({
    text: strings.drawer.sameMessage('래오', '레오'),
    refs: ['c_leo'],
  })
  // Still there to answer once the AI is back.
  expect(await screen.findByText(strings.drawer.sameName('래오', '레오'))).toBeTruthy()
})

test('a failed turn keeps the earlier questions, highlights and names', async () => {
  let fail = false
  serve((text) => (text && fail ? FAILED_TURN : turnOf(text)))
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(chatInput(), { target: { value: '테오는 북부 항구 출신이야.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  expect(await screen.findByText('몇 살인가요?')).toBeTruthy()
  await screen.findByText('알겠어요.')
  fail = true
  fireEvent.change(chatInput(), { target: { value: '나이는 몰라.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
  // Once the failed turn is over, what the AI last asked and changed still stands.
  await waitFor(() => {
    expect(chatInput().value).toBe('나이는 몰라.')
  })
  expect(screen.getByText('몇 살인가요?')).toBeTruthy()
  const sentence = screen.getByText('테오는 북부 항구 출신이다.', { exact: false })
  expect(sentence.closest('li')?.hasAttribute('data-changed')).toBe(true)
  expect(screen.getByText(strings.drawer.sameName('래오', '레오'))).toBeTruthy()
})

test('a failed turn never overwrites words typed while it ran', async () => {
  serve((text) => (text ? FAILED_TURN : turnOf(text)))
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const base = vi.mocked(fetch)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) =>
      url.endsWith('/drafts/dr_1/messages') && init.body !== '{"text":"","refs":[]}'
        ? gate.then(() => base(url, init))
        : base(url, init),
    ),
  )
  renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(chatInput(), { target: { value: '첫 말.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  expect(chatInput().value).toBe('')
  fireEvent.change(chatInput(), { target: { value: '새 말' } })
  release()
  expect(await screen.findByText(strings.drawer.errors.LLM_UNAVAILABLE ?? '')).toBeTruthy()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: strings.drawer.send })).toHaveProperty(
      'disabled',
      false,
    )
  })
  expect(chatInput().value).toBe('새 말')
})

test('closing with notes built up but no card asks first', async () => {
  serve(turnOf)
  const { onClose } = renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.change(chatInput(), { target: { value: '테오는 북부 항구 출신이야.' } })
  fireEvent.keyDown(chatInput(), { key: 'Enter' })
  await screen.findByText('테오는 북부 항구 출신이다.', { exact: false })
  fireEvent.keyDown(window, { key: 'Escape' })
  const ask = await screen.findByRole('alertdialog', { name: strings.drawer.closeTitle })
  expect(within(ask).getByText(strings.drawer.closeBody)).toBeTruthy()
  // The safe choice has focus; closing is red; nothing to save yet.
  expect(document.activeElement).toBe(
    within(ask).getByRole('button', { name: strings.preview.keep }),
  )
  const discard = within(ask).getByRole('button', { name: strings.drawer.closeDiscard })
  expect(discard.hasAttribute('data-danger')).toBe(true)
  expect(within(ask).queryByRole('button', { name: strings.preview.save })).toBeNull()
  fireEvent.click(within(ask).getByRole('button', { name: strings.preview.keep }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  // An outside click asks too.
  fireEvent.mouseDown(document.querySelector('.drawer-backdrop') as Element)
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.closeDiscard }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('the close button asks before dropping notes typed by hand', async () => {
  serve(turnOf)
  const { onClose } = renderDrawer()
  await screen.findByText(REPLY)
  fireEvent.click(await editButton())
  fireEvent.change(screen.getByLabelText(strings.drawer.editNotesLabel), {
    target: { value: '고치는 중이다.' },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.close }))
  expect(screen.getByRole('alertdialog', { name: strings.drawer.closeTitle })).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

test('a card opened for editing closes at once while its notes are as saved', async () => {
  serve(turnOf)
  route((method, path) =>
    method === 'POST' && path === '/works/w_1/drafts'
      ? baseDraft({
          card_id: 'c_teo',
          notes: '테오는 활을 쓴다.',
          sentences: ['테오는 활을 쓴다.'],
        })
      : undefined,
  )
  const { onClose } = renderDrawer({ workId: 'w_1', type: 'character', card_id: 'c_teo' })
  await screen.findByText('테오는 활을 쓴다.')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

const WORLD_DATA = {
  category: 'faction' as const,
  summary: '북부의 기사단',
  details: null,
  rules: [],
  terms: [],
  related: [],
}

test('a world card shows its saved category, with no tab hint', async () => {
  serve(turnOf)
  route((_method, path) =>
    path === '/cards/c_w'
      ? {
          id: 'c_w',
          work_id: 'w_1',
          type: 'world',
          name: '은빛 기사단',
          status: 'complete',
          source_notes: '',
          data: WORLD_DATA,
          evidence: {},
          ai_guess: [],
          pinned: [],
          schema_version: 1,
        }
      : undefined,
  )
  renderDrawer({ workId: 'w_1', type: 'world', card_id: 'c_w' })
  expect(
    await screen.findByText(
      `${strings.drawer.kind.world} · ${strings.drawer.edit} · ${strings.drawer.category.faction}`,
    ),
  ).toBeTruthy()
})

test('a new world card shows the generated category over the tab hint', async () => {
  serve(turnOf)
  route((method, path) =>
    method === 'POST' && path === '/works/w_1/drafts'
      ? baseDraft({
          type: 'world',
          category: 'rule',
          notes: '기사단이 있다.',
          sentences: ['기사단이 있다.'],
          turns: [{ role: 'ai', text: '어떤 설정인가요?' }],
          generated: {
            type: 'world',
            name: '은빛 기사단',
            data: WORLD_DATA,
            evidence: {},
            ai_guess: [],
          },
        })
      : undefined,
  )
  renderDrawer({ workId: 'w_1', type: 'world', category: 'rule' })
  expect(
    await screen.findByText(
      `${strings.drawer.kind.world} · ${strings.drawer.new} · ${strings.drawer.category.faction}`,
    ),
  ).toBeTruthy()
})

function part(id: string, order: number, title: string) {
  return {
    id,
    work_id: 'w_1',
    type: 'part',
    name: title,
    status: 'complete',
    source_notes: '',
    data: { order, title, theme: null, fulfills: [], start: null, end: null, structure: null },
    evidence: {},
    ai_guess: [],
    pinned: [],
    schema_version: 1,
  }
}

test('an episode shows its part and main region from the relation rows', async () => {
  serve(turnOf)
  route((_method, path) => {
    if (path === '/works/w_1/cards') {
      return {
        cards: [
          part('c_p2', 2, '귀환'),
          part('c_p1', 1, '출발'),
          { id: 'c_port', type: 'region', name: '북부 항구' },
          { id: 'c_lemon', type: 'region', name: '레몬 숲' },
        ],
      }
    }
    if (path === '/works/w_1/relations?kind=episode_part') {
      return { relations: [{ from_id: 'c_ep', to_id: 'c_p2', relation: '1' }] }
    }
    if (path === '/works/w_1/relations?kind=episode_region') {
      return {
        relations: [
          { from_id: 'c_ep', to_id: 'c_lemon', relation: null },
          { from_id: 'c_ep', to_id: 'c_port', relation: 'main' },
        ],
      }
    }
    return undefined
  })
  renderDrawer({ workId: 'w_1', type: 'episode', card_id: 'c_ep' })
  const head = [
    strings.drawer.kind.episode,
    strings.drawer.edit,
    strings.story.partLabel(2),
    '귀환',
    '북부 항구',
  ]
  expect(await screen.findByText(head.join(' · '))).toBeTruthy()
})

test('a new episode shows the part it goes to, its place undecided', async () => {
  serve(turnOf)
  route((_method, path) =>
    path === '/works/w_1/cards' ? { cards: [part('c_p1', 1, '출발')] } : undefined,
  )
  renderDrawer({ workId: 'w_1', type: 'episode', part_id: 'c_p1' })
  const head = [
    strings.drawer.kind.episode,
    strings.drawer.new,
    strings.story.partLabel(1),
    '출발',
    strings.drawer.noPlace,
  ]
  expect(await screen.findByText(head.join(' · '))).toBeTruthy()
})

test('a part shows the milestones it takes', async () => {
  serve(turnOf)
  route((_method, path) =>
    path === '/works/w_1/completeness'
      ? {
          milestones: [
            { id: 'ms_1', order: 1, text: '마을이 불탄다', parts: ['c_p1'], episodes: [] },
            { id: 'ms_2', order: 2, text: '스승을 만난다', parts: [], episodes: [] },
            { id: 'ms_3', order: 3, text: '왕이 된다', parts: ['c_p1'], episodes: [] },
          ],
          foreshadowing: [],
          incomplete: [],
        }
      : undefined,
  )
  renderDrawer({ workId: 'w_1', type: 'part', card_id: 'c_p1' })
  expect(
    await screen.findByText(`${strings.fields.fulfills ?? ''}: 마을이 불탄다 · 왕이 된다`),
  ).toBeTruthy()
})

const FIVE: FiveStageStructure = {
  type: 5,
  stages: [
    { name: '발단', summary: '테오가 돌아온다.', tension: 1 },
    { name: '전개', summary: '편지를 찾는다.', tension: 3 },
    { name: '위기', summary: '미라가 사라진다.', tension: 2 },
    { name: '절정', summary: '탑에서 맞선다.', tension: 5 },
    { name: '결말', summary: '항구를 떠난다.', tension: 2 },
  ],
}
// What the server makes of FIVE (§7: 기=발단, 승=전개+위기, 전=절정, 결=결말).
const FOUR: FourStageStructure = {
  type: 4,
  stages: [
    { name: '기', summary: '테오가 돌아온다.', tension: 1 },
    { name: '승', summary: '편지를 찾는다. 미라가 사라진다.', tension: 3 },
    { name: '전', summary: '탑에서 맞선다.', tension: 5 },
    { name: '결', summary: '항구를 떠난다.', tension: 2 },
  ],
}

function episodeOutput(
  structure: FiveStageStructure | FourStageStructure,
  theme = '귀환',
): CardOutput {
  return {
    type: 'episode',
    name: '1화',
    data: {
      part_id: 'c_p1',
      order: 1,
      theme,
      relation_to_main: null,
      fulfills: [],
      characters: [],
      locations: { main: null, others: [] },
      world: [],
      links: { prev: null, next: null, causes: [] },
      foreshadowing: { plants: [], payoffs: [] },
      worldline_id: null,
      structure,
      synopsis: null,
    },
    evidence: { structure: [0] },
    ai_guess: [],
  }
}

/** A new episode's draft with a generated card. 5→4 answers with FOUR in place of the
 * structure; a generation answers with `regenerated`. */
function serveEpisode(generated: CardOutput, regenerated: CardOutput, pinned: string[] = []) {
  let draft = baseDraft({
    pinned,
    type: 'episode',
    part_id: 'c_p1',
    notes: '테오가 돌아온다.',
    sentences: ['테오가 돌아온다.'],
    turns: [{ role: 'ai', text: '어떤 화인가요?' }],
    generated,
  })
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
      if (method === 'POST' && path === '/works/w_1/drafts') return json(draft, 201)
      if (method === 'GET' && path === '/drafts/dr_1') return json(draft)
      if (method === 'DELETE' && path === '/drafts/dr_1')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (method === 'PUT' && path === '/drafts/dr_1/structure') {
        const card = draft.generated
        if (card?.type !== 'episode') return json({ code: 'NOTHING_TO_CONVERT' }, 409)
        draft = { ...draft, generated: { ...card, data: { ...card.data, structure: FOUR } } }
        return json(draft)
      }
      if (method === 'POST' && path === '/drafts/dr_1/generate') {
        draft = { ...draft, generated: regenerated }
        return json({ jobId: 'job_1' }, 202)
      }
      if (path === '/jobs/job_1/events') return Promise.resolve(sse([['done', { result: {} }]]))
      if (path === '/works/w_1/cards') return json({ cards: [part('c_p1', 1, '출발')] })
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
}

const stageButton = (count: 4 | 5) =>
  within(screen.getByRole('group', { name: strings.typeSection.structure })).getByRole('button', {
    name: new RegExp(strings.typeSection.stages(count)),
  })

test('a pinned structure does not hold the old count once 4→5 is confirmed', async () => {
  const { calls } = serveEpisode(episodeOutput(FOUR), episodeOutput(FIVE), ['structure', 'theme'])
  renderDrawer({ workId: 'w_1', type: 'episode', part_id: 'c_p1' })
  await waitFor(() => {
    expect(stageButton(4).getAttribute('aria-pressed')).toBe('true')
  })
  fireEvent.click(stageButton(5))
  fireEvent.click(screen.getByRole('button', { name: strings.typeSection.regenerate }))
  await waitFor(() => {
    expect(stageButton(5).getAttribute('aria-pressed')).toBe('true')
  })
  expect(calls.filter((c) => c.path === '/drafts/dr_1/generate').map((c) => c.body)).toEqual([
    { pinned: ['theme'], structure: 5 },
  ])
})

test('the stage count question keeps the drawer from closing under it', async () => {
  serveEpisode(episodeOutput(FOUR), episodeOutput(FIVE))
  renderDrawer({ workId: 'w_1', type: 'episode', part_id: 'c_p1' })
  await waitFor(() => {
    expect(stageButton(4).getAttribute('aria-pressed')).toBe('true')
  })
  fireEvent.click(stageButton(5))
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.close }))
  // Only the stage count question is up.
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
  expect(
    screen.getByRole('alertdialog', { name: strings.typeSection.regenerateTitle(5) }),
  ).toBeTruthy()
})

test('5→4 maps the stages without the model and keeps the rest of the card', async () => {
  const { calls } = serveEpisode(episodeOutput(FIVE), episodeOutput(FIVE, '새 주제'))
  renderDrawer({ workId: 'w_1', type: 'episode', part_id: 'c_p1' })
  await waitFor(() => {
    expect(stageButton(5).getAttribute('aria-pressed')).toBe('true')
  })
  expect(screen.getByText(strings.typeSection.fiveNote)).toBeTruthy()
  fireEvent.click(stageButton(4))
  await waitFor(() => {
    expect(stageButton(4).getAttribute('aria-pressed')).toBe('true')
  })
  // No question, no generation: one PUT, and the card shows 기승전결 with its theme kept.
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(calls.filter((c) => c.path === '/drafts/dr_1/generate')).toHaveLength(0)
  expect(calls.filter((c) => c.path === '/drafts/dr_1/structure')).toEqual([
    { method: 'PUT', path: '/drafts/dr_1/structure', body: { type: 4 } },
  ])
  expect(screen.getByText(/승: 편지를 찾는다\. 미라가 사라진다\./)).toBeTruthy()
  expect(screen.getAllByText('귀환').length).toBeGreaterThan(0)
  expect(screen.queryByText('새 주제')).toBeNull()
  expect(screen.getByText(strings.typeSection.fourNote)).toBeTruthy()
  // The next generation keeps the picked count.
  fireEvent.click(screen.getByRole('button', { name: strings.preview.regenerate }))
  await waitFor(() => {
    expect(calls.find((c) => c.path === '/drafts/dr_1/generate')?.body).toEqual({
      pinned: [],
      structure: 4,
    })
  })
})

test('4→5 asks first: keeping the card changes nothing, yes generates again', async () => {
  const { calls } = serveEpisode(episodeOutput(FOUR), episodeOutput(FIVE, '새 주제'))
  renderDrawer({ workId: 'w_1', type: 'episode', part_id: 'c_p1' })
  await waitFor(() => {
    expect(stageButton(4).getAttribute('aria-pressed')).toBe('true')
  })
  fireEvent.click(stageButton(5))
  const ask = screen.getByRole('alertdialog', { name: strings.typeSection.regenerateTitle(5) })
  expect(within(ask).getByText(strings.typeSection.regenerateBody)).toBeTruthy()
  // The safe choice has focus; generating again is red.
  const keep = within(ask).getByRole('button', { name: strings.typeSection.keepCard })
  expect(document.activeElement).toBe(keep)
  const again = within(ask).getByRole('button', { name: strings.typeSection.regenerate })
  expect(again.hasAttribute('data-danger')).toBe(true)
  fireEvent.click(keep)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(calls.filter((c) => c.path.startsWith('/drafts/dr_1/') && c.method !== 'GET')).toEqual([])
  expect(stageButton(4).getAttribute('aria-pressed')).toBe('true')
  // Esc keeps the card too, and leaves the drawer open.
  fireEvent.click(stageButton(5))
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()

  fireEvent.click(stageButton(5))
  fireEvent.click(screen.getByRole('button', { name: strings.typeSection.regenerate }))
  await waitFor(() => {
    expect(stageButton(5).getAttribute('aria-pressed')).toBe('true')
  })
  expect(calls.filter((c) => c.path === '/drafts/dr_1/generate').map((c) => c.body)).toEqual([
    { pinned: [], structure: 5 },
  ])
  expect(calls.filter((c) => c.path === '/drafts/dr_1/structure')).toHaveLength(0)
  expect(screen.getAllByText('새 주제').length).toBeGreaterThan(0)
})

// Edit mode before saving (§8): a new name lists the cards referencing this one; changed ties
// list the cards gaining or losing one.

function character(id: string, name: string, data: Partial<CharacterData> = {}) {
  return {
    id,
    work_id: 'w_1',
    type: 'character' as const,
    name,
    status: 'complete' as const,
    source_notes: '아라는 기사다.',
    data: {
      theme: '귀향',
      personality: { traits: [], behaviors: [] },
      speech: { description: null, examples: [] },
      appearance: { summary: null, details: null },
      relations: [],
      origin_region_id: null,
      ...data,
    },
    evidence: {},
    ai_guess: [],
    pinned: [],
    schema_version: 1,
  }
}

const OTHERS = [
  character('c_b', '보라'),
  character('c_c', '체리'),
  character('c_d', '다온'),
  { id: 'c_port', type: 'region', name: '북부 항구' },
]

/** Edit mode for `saved`, its draft holding `generated`; the work holds OTHERS and `saved`.
 * The references route answers with 다온 (who points at the card). */
function serveEdit(saved: Card, generated: CardOutput) {
  serve(turnOf)
  const asked = { references: 0 }
  const draft = baseDraft({
    type: saved.type,
    card_id: saved.id,
    notes: saved.source_notes,
    sentences: [saved.source_notes],
    generated,
  })
  route((_method, path) => {
    if (path === '/works/w_1/drafts' || path === '/drafts/dr_1') return draft
    if (path === `/cards/${saved.id}`) return saved
    if (path === '/works/w_1/cards') return { cards: [...OTHERS, saved] }
    if (path === `/cards/${saved.id}/references`) {
      asked.references += 1
      return {
        references: [{ card_id: 'c_d', type: 'character', name: '다온', field: 'relations' }],
      }
    }
    return undefined
  })
  renderDrawer({ workId: 'w_1', type: saved.type, card_id: saved.id })
  return asked
}

function output(card: Card, name = card.name): CardOutput {
  return { type: card.type, name, data: card.data, evidence: {}, ai_guess: [] } as CardOutput
}

async function notice(heading: string): Promise<string[]> {
  const head = await screen.findByText(heading)
  const box = head.closest<HTMLElement>('[role="note"]')
  if (box === null) throw new Error('no notice')
  return within(box)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

const item = (name: string, kind: string, change?: 'added' | 'removed') =>
  `${name} ${kind}${change ? ` · ${strings.preview.tie[change]}` : ''}`

test('a character gaining a relation lists that character, not the cards pointing at it', async () => {
  const ara = character('c_a', '아라', { relations: [{ target_id: 'c_b', relation: '친구' }] })
  const next = character('c_a', '아라', {
    relations: [
      { target_id: 'c_b', relation: '친구' },
      { target_id: 'c_c', relation: '스승' },
    ],
  })
  const asked = serveEdit(ara, output(next))
  expect(await notice(strings.preview.ties)).toEqual([
    item('체리', strings.drawer.kind.character, 'added'),
  ])
  expect(screen.getByText(strings.preview.tiesNote.character)).toBeTruthy()
  expect(screen.queryByText(strings.preview.references)).toBeNull()
  expect(asked.references).toBe(0)
})

test('a character losing a relation lists that character as removed', async () => {
  const ara = character('c_a', '아라', {
    relations: [
      { target_id: 'c_b', relation: '친구' },
      { target_id: 'c_c', relation: '스승' },
    ],
  })
  const next = character('c_a', '아라', { relations: [{ target_id: 'c_c', relation: '스승' }] })
  serveEdit(ara, output(next))
  expect(await notice(strings.preview.ties)).toEqual([
    item('보라', strings.drawer.kind.character, 'removed'),
  ])
})

test('a relation whose words change only gains or loses no tie', async () => {
  const ara = character('c_a', '아라', { relations: [{ target_id: 'c_b', relation: '친구' }] })
  const next = character('c_a', '아라', { relations: [{ target_id: 'c_b', relation: '원수' }] })
  serveEdit(ara, output(next))
  // Loaded: the old relation shows struck, read by name.
  await waitFor(() => {
    expect(screen.getByLabelText(strings.preview.before).textContent).toContain('보라')
  })
  expect(screen.queryByText(strings.preview.ties)).toBeNull()
  expect(screen.queryByText(strings.preview.references)).toBeNull()
})

test('an episode adding and removing characters lists both, marked', async () => {
  const before = episodeOutput(FIVE)
  if (before.type !== 'episode') throw new Error('episode')
  const saved = {
    ...before,
    id: 'c_ep',
    work_id: 'w_1',
    status: 'complete' as const,
    source_notes: '테오가 돌아온다.',
    pinned: [],
    schema_version: 1,
    data: { ...before.data, characters: ['c_b', 'c_d'] },
  }
  const generated = { ...before, data: { ...before.data, characters: ['c_d', 'c_c', 'c_port'] } }
  serveEdit(saved, generated)
  // 북부 항구 is no character: save would not keep it, so it is not listed.
  expect(await notice(strings.preview.ties)).toEqual([
    item('체리', strings.drawer.kind.character, 'added'),
    item('보라', strings.drawer.kind.character, 'removed'),
  ])
  expect(screen.getByText(strings.preview.tiesNote.episode)).toBeTruthy()
})

test('a new name still lists the cards that reference this card', async () => {
  const ara = character('c_a', '아라', { relations: [{ target_id: 'c_b', relation: '친구' }] })
  serveEdit(ara, output(ara, '아란'))
  expect(await notice(strings.preview.references)).toEqual([
    item('다온', strings.drawer.kind.character),
  ])
  expect(screen.getByText(strings.preview.referencesNote)).toBeTruthy()
  expect(screen.queryByText(strings.preview.ties)).toBeNull()
})
