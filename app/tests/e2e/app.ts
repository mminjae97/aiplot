import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

/** Starts the built app on a fresh data dir with the fixture LLM (§4), runs `use`, then closes
 * it and removes the data dir. */
export async function withApp(use: (app: ElectronApplication) => Promise<void>): Promise<void> {
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
    await use(app)
  } finally {
    try {
      await app.close()
    } finally {
      // Chromium helpers and the server (which stops once Electron is gone) may hold files
      // briefly after close on Windows.
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 })
    }
  }
}
