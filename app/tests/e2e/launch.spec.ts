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

    // The top bar is the title bar: its buttons drive the real window.
    const state = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        return { maximized: window?.isMaximized(), minimized: window?.isMinimized() }
      })
    await win.getByRole('button', { name: strings.window.maximize }).click()
    await expect.poll(state).toMatchObject({ maximized: true })
    await win.getByRole('button', { name: strings.window.restore }).click()
    await expect.poll(state).toMatchObject({ maximized: false })
    await win.getByRole('button', { name: strings.window.minimize }).click()
    await expect.poll(state).toMatchObject({ minimized: true })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.restore()
    })
    await expect.poll(state).toMatchObject({ minimized: false })

    // A new book opens to its contents and then stands on the shelf.
    await win.getByRole('button', { name: strings.library.newBook }).click()
    await win.getByLabel(strings.newBook.label).fill('안개의 항구')
    await win.getByRole('button', { name: strings.newBook.create, exact: true }).click()
    await expect(win.getByRole('heading', { name: strings.contents.heading })).toBeVisible()

    // The window cannot shrink below half the screen's width, and there the open book is as
    // wide as the width allows (4:3 inside the desk margin). It also opens at least that big.
    const min = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('no window')
      const [width = 0, height = 0] = window.getMinimumSize()
      const [openWidth = 0, openHeight = 0] = window.getSize()
      if (openWidth < width || openHeight < height) throw new Error('opened below its minimum')
      window.setSize(width, height)
      return {
        width,
        half: Math.floor(screen.getDisplayMatching(window.getBounds()).workAreaSize.width / 2),
      }
    })
    expect(min.width).toBe(min.half)
    const pageWidth = Number(await win.evaluate('window.innerWidth'))
    await expect
      .poll(async () => {
        const spread = await win.locator('.spread').boundingBox()
        return spread ? [Math.round(spread.width), Math.round(spread.height)] : null
      })
      .toEqual([pageWidth - 128, Math.round((pageWidth - 128) * 0.75)])

    // The world book's six bookmarks fit on one line of the left page even here.
    await win.getByRole('button', { name: '세계관' }).click()
    const tabs = win.getByRole('tablist', { name: strings.worldBook.tabs })
    await expect(tabs.getByRole('tab')).toHaveCount(6)
    const page = await win.locator('.world-book .page-left').boundingBox()
    const boxes = await Promise.all(
      (await tabs.getByRole('tab').all()).map((tab) => tab.boundingBox()),
    )
    expect(new Set(boxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1)
    const right = Math.max(...boxes.map((box) => (box ? box.x + box.width : Infinity)))
    expect(right).toBeLessThanOrEqual((page?.x ?? 0) + (page?.width ?? 0))
    await win.getByRole('button', { name: strings.contents.toContents }).click()
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
