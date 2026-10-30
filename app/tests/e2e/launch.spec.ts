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

    // A new book opens to its contents and then stands on the shelf.
    await win.getByRole('button', { name: strings.library.newBook }).click()
    await win.getByLabel(strings.newBook.label).fill('안개의 항구')
    await win.getByRole('button', { name: strings.newBook.create, exact: true }).click()
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
