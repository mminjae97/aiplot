import { test } from '@playwright/test'
import { withApp } from './app'
import { saveACharacter } from './flows'

test('a character is talked over, generated and saved into the dex', async () => {
  // Server start, a chat turn and a generation each have their own wait; together they may
  // run past the default 60s on a slow runner.
  test.setTimeout(120_000)
  await withApp(saveACharacter)
})
