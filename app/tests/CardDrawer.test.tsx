import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { CardDrawer, type DrawerRequest } from '../src/components/CardDrawer'
import { ContentsPage } from '../src/screens/ContentsPage'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Draft, Work } from '../src/types'
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
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: () => () => undefined,
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

test('the contents page opens the drawer from the planning items', async () => {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ContentsPage workId="w_1" />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '캐릭터' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(document.querySelector('main.desk')?.hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '스토리' }))
  // No part yet (the list has answered): a new episode has nowhere to go.
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/api/v1/works/w_1/cards?type=part',
      expect.anything(),
    )
  })
  expect(screen.getByRole('button', { name: strings.drawer.temporary.newEpisode })).toHaveProperty(
    'disabled',
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: strings.drawer.temporary.mainStory }))
  expect(
    await screen.findByText(`${strings.drawer.kind.main_story} · ${strings.drawer.new}`),
  ).toBeTruthy()
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
