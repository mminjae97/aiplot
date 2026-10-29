import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strings } from '../../src/strings'

test('app window opens with title', async () => {
  // Always test the built renderer, never a leftover dev server URL.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'ELECTRON_RENDERER_URL' && entry[1] !== undefined,
    ),
  )
  const dataDir = mkdtempSync(join(tmpdir(), 'aiplot-e2e-'))
  env.AIPLOT_DATA_DIR = dataDir
  const app = await electron.launch({ args: [resolve(__dirname, '../..')], env })
  try {
    const win = await app.firstWindow()
    await expect(win).toHaveTitle(strings.app.name)
    await expect(win.getByRole('heading', { name: strings.app.name })).toBeVisible()
  } finally {
    try {
      await app.close()
    } finally {
      // Chromium helpers may hold profile files briefly after close on Windows.
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
})
