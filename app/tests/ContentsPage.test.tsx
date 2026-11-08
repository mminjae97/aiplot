import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { StageReopenPreview, Work } from '../src/types'
import { renderBook } from './bookHarness'
import { NO_DIALOGS } from './serverFixtures'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

const DIRECTING: Work = {
  id: 'w_1',
  title: '이름 없는 기사의 노래',
  stage: 2,
  locked_stage: 1,
  last_item: null,
  color: null,
  cover_id: null,
  updated_at: '2026-11-08T00:00:00.000Z',
}

type Call = { method: string; path: string; body: unknown }

function serve(preview: StageReopenPreview, reopen: { status: number; body: unknown }) {
  const calls: Call[] = []
  let work = DIRECTING
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ method, path, body })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works/w_1') return json(work)
      if (path === '/works/w_1/stage/reopen-preview?stage=1') return json(preview)
      if (method === 'POST' && path === '/works/w_1/stage/reopen') {
        if (reopen.status === 200) work = reopen.body as Work
        return json(reopen.body, reopen.status)
      }
      return json({ code: 'NOT_FOUND', message: path, hint: null }, 404)
    }),
  )
  return { calls }
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

const PLANS: StageReopenPreview = { stage: 1, plans: 2, chapters: 0, title_required: false }
const REOPENED: Work = { ...DIRECTING, stage: 1, locked_stage: 0 }

async function openReopen() {
  renderBook({ name: 'contents', workId: 'w_1' })
  const button = await screen.findByRole('button', {
    name: strings.contents.reopenOf(strings.stage[1]),
  })
  // The four planning items are read-only; the heading names only the stage.
  expect(screen.getAllByText(strings.contents.locked)).toHaveLength(4)
  expect(screen.getByRole('heading', { name: strings.stage[1] })).toBeTruthy()
  fireEvent.click(button)
  return screen.findByRole('alertdialog', { name: strings.contents.reopenOf(strings.stage[1]) })
}

test('the warning counts what a reopen deletes', () => {
  expect(strings.stageLock.reopenDeletes('기획', 2, 0)).toBe(
    '기획 단계를 다시 열면 연출 계획서 2개가 삭제돼요.',
  )
  expect(strings.stageLock.reopenDeletes('기획', 3, 12)).toBe(
    '기획 단계를 다시 열면 연출 계획서 3개와 집필한 원고 12화가 삭제돼요.',
  )
})

test('다시 열기 says what is deleted, then reopens planning', async () => {
  const { calls } = serve(PLANS, { status: 200, body: REOPENED })
  const dialog = await openReopen()
  expect(
    await within(dialog).findByText(strings.stageLock.reopenDeletes(strings.stage[1], 2, 0)),
  ).toBeTruthy()
  expect(within(dialog).getByText(strings.stageLock.snapshot)).toBeTruthy()
  // Never the default: the focus starts on 취소; no manuscript, so no title to type.
  await waitFor(() => {
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: strings.stageLock.cancel }),
    )
  })
  expect(within(dialog).queryByRole('textbox')).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: strings.stageLock.reopen }))
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
  expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ stage: 1, title: '' })
  // Planning is open again: nothing locked left to reopen.
  await waitFor(() => {
    expect(screen.queryByText(strings.contents.locked)).toBeNull()
  })
  expect(screen.getByText(strings.library.stageOf(strings.stage[1]))).toBeTruthy()
})

test('a manuscript to delete waits for the title typed', async () => {
  serve({ ...PLANS, chapters: 12, title_required: true }, { status: 200, body: REOPENED })
  const dialog = await openReopen()
  const input = await within(dialog).findByRole('textbox')
  const reopen = within(dialog).getByRole('button', { name: strings.stageLock.reopen })
  expect(reopen.hasAttribute('disabled')).toBe(true)
  // Spacing is forgiven as the server cleans titles.
  fireEvent.change(input, { target: { value: ' 이름 없는  기사의 노래 ' } })
  expect(reopen.hasAttribute('disabled')).toBe(false)
})

test('a failed snapshot says so and keeps the stage locked', async () => {
  serve(PLANS, { status: 500, body: { code: 'SNAPSHOT_FAILED', message: 'disk', hint: null } })
  const dialog = await openReopen()
  await within(dialog).findByText(strings.stageLock.reopenDeletes(strings.stage[1], 2, 0))
  fireEvent.click(within(dialog).getByRole('button', { name: strings.stageLock.reopen }))
  expect(await within(dialog).findByText(strings.stageLock.snapshotFailed)).toBeTruthy()
  expect(screen.getAllByText(strings.contents.locked)).toHaveLength(4)
})
