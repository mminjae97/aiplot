import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strings } from '../../src/strings'

test('app window opens with title', async () => {
  const app = await electron.launch({ args: [resolve(__dirname, '../..')] })
  try {
    const win = await app.firstWindow()
    await expect(win).toHaveTitle(strings.app.name)
    await expect(win.getByRole('heading', { name: strings.app.name })).toBeVisible()
  } finally {
    await app.close()
  }
})
