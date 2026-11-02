import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { withApp } from './app'
import { saveACharacter } from './flows'

// The installed app (§20 unit 14): electron-builder's unpacked build with the PyInstaller
// server in resources/. Run only when asked (AIPLOT_E2E_PACKAGED=1, after `npm run dist`), so
// a stale build is never tested by accident.
const exe = resolve(__dirname, '../../dist/win-unpacked/Aiplot.exe')

test('the packaged app starts its bundled server and saves a character', async () => {
  test.skip(process.env.AIPLOT_E2E_PACKAGED !== '1', 'set AIPLOT_E2E_PACKAGED=1 after npm run dist')
  expect(existsSync(exe), `${exe} (run npm run dist first)`).toBe(true)
  test.setTimeout(180_000)
  await withApp(saveACharacter, exe)
})
