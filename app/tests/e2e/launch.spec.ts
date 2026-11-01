import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strings } from '../../src/strings'

test('app starts the local server, opens the library and makes a book', async () => {
  // Always test the built renderer, never a leftover dev server URL.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'ELECTRON_RENDERER_URL' && entry[1] !== undefined,
    ),
  )
  const dataDir = mkdtempSync(join(tmpdir(), 'aiplot-e2e-'))
  env.AIPLOT_DATA_DIR = dataDir
  // Fixture LLM: no GPU or model download (§4).
  env.AIPLOT_FAKE_LLM = '1'
  const app = await electron.launch({ args: [resolve(__dirname, '../..')], env })
  try {
    const win = await app.firstWindow()
    await expect(win).toHaveTitle(strings.app.name)
    // The library loads only through the server Electron started (works list, §13).
    await expect(win.getByText(strings.library.empty)).toBeVisible({ timeout: 45_000 })
    await expect(win.getByRole('heading', { name: strings.app.name })).toBeVisible()

    // The top bar is the title bar. The window is always maximized: its buttons are minimize
    // and close only, and whatever restores it to a normal window maximizes it again.
    const state = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        return { maximized: window?.isMaximized(), minimized: window?.isMinimized() }
      })
    await expect.poll(state).toMatchObject({ maximized: true })
    await expect(win.locator('.window-controls button')).toHaveCount(2)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.unmaximize()
    })
    await expect.poll(state).toMatchObject({ maximized: true })
    await win.getByRole('button', { name: strings.window.minimize }).click()
    await expect.poll(state).toMatchObject({ minimized: true })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore()
    })
    await expect.poll(state).toMatchObject({ minimized: false, maximized: true })

    // A new book opens to its contents and then stands on the shelf.
    await win.getByRole('button', { name: strings.library.newBook }).click()
    await win.getByLabel(strings.newBook.label).fill('안개의 항구')
    await win.getByRole('button', { name: strings.newBook.create, exact: true }).click()
    await expect(win.getByRole('heading', { name: strings.contents.heading })).toBeVisible()

    // The open book is as large as the maximized window allows: a 3:2 spread inside the desk
    // margin (24px above and below, 120px at the sides), usually as tall as the window.
    await expect
      .poll(async () => {
        const spread = await win.locator('.spread').boundingBox()
        const [width, height] = await win.evaluate<number[]>('[innerWidth, innerHeight]')
        const fit = Math.min((width ?? 0) - 240, ((height ?? 0) - 48 - 48) * 1.5)
        return spread
          ? Math.abs(spread.width - fit) <= 1 && Math.abs(spread.height - fit / 1.5) <= 1
          : null
      })
      .toBe(true)

    // The world book's bookmarks never run past the left page; on a page 408px wide or more
    // they fit on one line (smaller pages wrap them).
    await win
      .getByRole('region', { name: strings.contents.heading })
      .getByRole('button', { name: '세계관' })
      .click()
    const tabs = win.getByRole('tablist', { name: strings.worldBook.tabs })
    await expect(tabs.getByRole('tab')).toHaveCount(6)
    const page = await win.locator('.world-book .page-left').boundingBox()
    const boxes = await Promise.all(
      (await tabs.getByRole('tab').all()).map((tab) => tab.boundingBox()),
    )
    if ((page?.width ?? 0) >= 408) {
      expect(new Set(boxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1)
    }
    const right = Math.max(...boxes.map((box) => (box ? box.x + box.width : Infinity)))
    expect(right).toBeLessThanOrEqual((page?.x ?? 0) + (page?.width ?? 0))
    // Opening another bookmark moves neither the bookmarks nor the index under them.
    const heading = win.locator('.world-index h2')
    const headingBefore = await heading.boundingBox()
    await tabs.getByRole('tab').nth(2).click()
    await expect(tabs.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true')
    const after = await Promise.all(
      (await tabs.getByRole('tab').all()).map((tab) => tab.boundingBox()),
    )
    expect(after).toEqual(boxes)
    expect((await heading.boundingBox())?.y).toBe(headingBefore?.y)
    // The contents is a page of the same book: its post-it note turns back to it.
    await win
      .getByRole('navigation', { name: strings.book.sections })
      .getByRole('button', { name: strings.book.notes.contents })
      .click()
    await expect(win.getByRole('heading', { name: strings.contents.heading })).toBeVisible()
    await win.getByRole('button', { name: strings.contents.back }).click()
    await expect(win.locator('.book-title', { hasText: '안개의 항구' })).toBeVisible()
  } finally {
    try {
      await app.close()
    } finally {
      // Chromium helpers and the server (which stops once Electron is gone) may hold files
      // briefly after close on Windows.
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 })
    }
  }
})
