import { _electron as electron, expect, test } from '@playwright/test'

test('app window opens with title', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()
  await expect(win).toHaveTitle('Aiplot')
  await expect(win.getByRole('heading', { name: '에이플롯' })).toBeVisible()
  await app.close()
})
