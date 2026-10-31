import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AiplotBridge, ServerState } from '../src/api/bridge'
import { App } from '../src/App'
import { CoverImageError, cropCover } from '../src/components/cropCover'
import { useNavigation } from '../src/stores/navigation'
import { connectServer, useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { Cover, Work } from '../src/types'

// jsdom has no canvas: the crop is tested by its maths (bookColor.test.ts); here it passes a
// fixed WebP through.
vi.mock('../src/components/cropCover', async (original) => ({
  ...(await original<typeof import('../src/components/cropCover')>()),
  cropCover: vi.fn(() => Promise.resolve(new Blob(['webp'], { type: 'image/webp' }))),
}))

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

function bridge(): AiplotBridge {
  return {
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
  }
}

function book(id: string, title: string): Work {
  return {
    id,
    title,
    stage: 1,
    locked_stage: 0,
    last_item: null,
    color: null,
    cover_id: null,
    updated_at: '2026-10-31T09:00:00.000Z',
  }
}

type Call = { method: string; path: string; body: unknown }

/** The works and covers API in memory, behind fetch. */
function serve(initial: Work[]) {
  const works = initial.map((w) => ({ ...w }))
  const covers: Cover[] = []
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace('http://127.0.0.1:9100/api/v1', '')
      const method = init.method ?? 'GET'
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      calls.push({ method, path, body })
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }))
      if (path === '/works') return json({ works })
      const match = /^\/works\/(w_\w+)(?:\/covers(?:\/(cv_\w+))?(\/image)?)?$/.exec(path)
      const found = works.find((w) => w.id === match?.[1])
      if (!match || !found) return json({ code: 'WORK_NOT_FOUND', message: 'no', hint: null }, 404)
      const [, , coverId, image] = match
      if (path.endsWith('/covers')) {
        if (method === 'GET') return json({ covers: covers.filter((c) => c.work_id === found.id) })
        const cover = {
          id: `cv_${String(covers.length + 1)}`,
          work_id: found.id,
          created_at: '2026-10-31T10:00:00.000Z',
        }
        covers.push(cover)
        return json(cover, 201)
      }
      if (coverId && image)
        return Promise.resolve(new Response('img', { headers: { 'Content-Type': 'image/webp' } }))
      if (coverId && method === 'DELETE') {
        covers.splice(
          covers.findIndex((c) => c.id === coverId),
          1,
        )
        if (found.cover_id === coverId) found.cover_id = null
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (method === 'PATCH') Object.assign(found, body)
      return json(found)
    }),
  )
  return { calls, covers }
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

async function openDecorate(title: string) {
  fireEvent.contextMenu(await screen.findByRole('button', { name: title }), {
    clientX: 300,
    clientY: 200,
  })
  fireEvent.click(screen.getByRole('menuitem', { name: strings.bookMenu.decorate }))
  return screen.getByRole('dialog', { name: strings.decorate.title })
}

beforeEach(() => {
  useServer.setState({ state: null })
  useNavigation.setState({ screen: { name: 'library' }, highlight: null })
  window.aiplot = bridge()
  connectServer()
  vi.mocked(cropCover).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('right-click opens the book menu; not-ready items say so and Escape closes', async () => {
  serve([book('w_a', '안개의 항구')])
  renderApp()
  const cover = await screen.findByRole('button', { name: '안개의 항구' })
  cover.focus()
  fireEvent.contextMenu(cover, { clientX: 300, clientY: 200 })
  const menu = screen.getByRole('menu', { name: strings.bookMenu.label('안개의 항구') })
  const items = within(menu).getAllByRole('menuitem')
  expect(items.map((i) => i.textContent)).toEqual([
    strings.bookMenu.decorate,
    `${strings.bookMenu.rename}${strings.bookMenu.later}`,
    `${strings.bookMenu.backup}${strings.bookMenu.later}`,
    `${strings.bookMenu.delete}${strings.bookMenu.later}`,
  ])
  expect(items.slice(1).every((i) => i.getAttribute('aria-disabled') === 'true')).toBe(true)
  expect(document.activeElement).toBe(items[0])
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1])
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(items[3])
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(cover)
  // A scroll the focus causes keeps it open; the user's own wheel or a click away closes it.
  fireEvent.contextMenu(cover, { clientX: 300, clientY: 200 })
  fireEvent.scroll(document.querySelector('.library') ?? window)
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.wheel(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.contextMenu(cover, { clientX: 300, clientY: 200 })
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('a cloth colour is saved and shown on the shelf', async () => {
  const { calls } = serve([book('w_a', '안개의 항구')])
  renderApp()
  const dialog = await openDecorate('안개의 항구')
  expect(document.activeElement).toBe(within(dialog).getByLabelText(strings.decorate.coverColor))
  fireEvent.click(within(dialog).getByLabelText('숲초록'))
  const preview = dialog.querySelector<HTMLElement>('.decorate-preview')
  expect(preview?.style.getPropertyValue('--binding')).toBe('#2f4a3a')
  fireEvent.click(within(dialog).getByRole('button', { name: strings.decorate.save }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
    path: '/works/w_a',
    body: { color: '#2f4a3a', cover_id: null },
  })
  await waitFor(() => {
    expect(document.querySelector<HTMLElement>('.book')?.style.getPropertyValue('--binding')).toBe(
      '#2f4a3a',
    )
  })
})

test('cancel leaves the book as it was and focus goes back to it', async () => {
  const { calls } = serve([book('w_a', '안개의 항구')])
  renderApp()
  const dialog = await openDecorate('안개의 항구')
  fireEvent.click(within(dialog).getByLabelText('남색'))
  fireEvent.click(within(dialog).getByRole('button', { name: strings.decorate.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '안개의 항구' }))
})

test('an uploaded illustration becomes the cover', async () => {
  const { calls } = serve([book('w_a', '안개의 항구')])
  renderApp()
  const dialog = await openDecorate('안개의 항구')
  fireEvent.click(within(dialog).getByLabelText(strings.decorate.coverIllustration))
  expect(await within(dialog).findByText(strings.decorate.noIllustrations)).toBeTruthy()
  // Nothing to show yet, so it cannot be saved as an illustrated cover.
  const save = within(dialog).getByRole('button', { name: strings.decorate.save })
  expect(save).toHaveProperty('disabled', true)
  const picture = new File(['png'], 'cover.png', { type: 'image/png' })
  fireEvent.change(within(dialog).getByLabelText(strings.decorate.upload), {
    target: { files: [picture] },
  })
  const choice = await within(dialog).findByLabelText(strings.decorate.illustration(1))
  expect(cropCover).toHaveBeenCalledWith(picture)
  const upload = calls.find((c) => c.method === 'POST')
  expect(upload?.path).toBe('/works/w_a/covers')
  expect(upload?.body).toBeInstanceOf(Blob)
  expect(choice).toHaveProperty('checked', true)
  await waitFor(() => {
    expect(dialog.querySelector('.decorate-preview img')?.getAttribute('src')).toMatch(/^data:/)
  })
  fireEvent.click(save)
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ color: null, cover_id: 'cv_1' })
  await waitFor(() => {
    expect(document.querySelector('.book img.book-art')?.getAttribute('src')).toMatch(/^data:/)
  })
  expect(document.querySelector('.book-title')).toBeNull()
})

test('removing the cover in use asks first and turns the book back to cloth', async () => {
  const { calls, covers } = serve([{ ...book('w_a', '안개의 항구'), cover_id: 'cv_1' }])
  covers.push({ id: 'cv_1', work_id: 'w_a', created_at: '2026-10-31T10:00:00.000Z' })
  renderApp()
  await waitFor(() => {
    expect(document.querySelector('.book img.book-art')).not.toBeNull()
  })
  const dialog = await openDecorate('안개의 항구')
  const remove = await within(dialog).findByRole('button', {
    name: `${strings.decorate.illustration(1)} ${strings.decorate.remove}`,
  })
  fireEvent.click(remove)
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  expect(within(dialog).getByText(strings.decorate.removeConfirm)).toBeTruthy()
  // Focus never falls out of the dialog while the buttons swap: the safe choice first.
  const keep = within(dialog).getByRole('button', { name: strings.decorate.removeNo })
  expect(document.activeElement).toBe(keep)
  fireEvent.click(keep)
  expect(document.activeElement).toBe(
    within(dialog).getByRole('button', {
      name: `${strings.decorate.illustration(1)} ${strings.decorate.remove}`,
    }),
  )
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: `${strings.decorate.illustration(1)} ${strings.decorate.remove}`,
    }),
  )
  fireEvent.click(within(dialog).getByRole('button', { name: strings.decorate.removeYes }))
  expect(await within(dialog).findByText(strings.decorate.noIllustrations)).toBeTruthy()
  await waitFor(() => {
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: strings.decorate.upload }),
    )
  })
  expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/works/w_a/covers/cv_1')
  await waitFor(() => {
    expect(document.querySelector('.book .book-title')?.textContent).toBe('안개의 항구')
  })
})

test('moving the confirmation to another illustration moves focus with it', async () => {
  const { covers } = serve([book('w_a', '안개의 항구')])
  for (const id of ['cv_1', 'cv_2']) {
    covers.push({ id, work_id: 'w_a', created_at: '2026-10-31T10:00:00.000Z' })
  }
  renderApp()
  const dialog = await openDecorate('안개의 항구')
  fireEvent.click(within(dialog).getByLabelText(strings.decorate.coverIllustration))
  const removeOf = (n: number) =>
    within(dialog).findByRole('button', {
      name: `${strings.decorate.illustration(n)} ${strings.decorate.remove}`,
    })
  for (const n of [2, 1]) {
    fireEvent.click(await removeOf(n))
    const panel = within(dialog).getByRole('group', { name: strings.decorate.illustration(n) })
    expect(document.activeElement).toBe(
      within(panel).getByRole('button', { name: strings.decorate.removeNo }),
    )
  }
})

test('a file that is not a picture explains itself', async () => {
  vi.mocked(cropCover).mockRejectedValueOnce(new CoverImageError('not a readable image'))
  const { calls } = serve([book('w_a', '안개의 항구')])
  renderApp()
  const dialog = await openDecorate('안개의 항구')
  fireEvent.click(within(dialog).getByLabelText(strings.decorate.coverIllustration))
  fireEvent.change(within(dialog).getByLabelText(strings.decorate.upload), {
    target: { files: [new File(['x'], 'notes.txt')] },
  })
  expect(await within(dialog).findByText(strings.decorate.notImage)).toBeTruthy()
  expect(calls.some((c) => c.method === 'POST')).toBe(false)
})
