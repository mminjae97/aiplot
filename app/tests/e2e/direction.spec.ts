import { test } from '@playwright/test'
import { withApp } from './app'
import { directAnEpisode, seedAcademy } from './flows'

test('an episode is planned, and its scenes picked, directed and confirmed', async () => {
  test.setTimeout(180_000)
  await withApp(directAnEpisode, undefined, seedAcademy)
})
