import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { type ElectronApplication, expect } from '@playwright/test'
import { strings } from '../../src/strings'

/** §19 E2E: library → contents → a character talked over, generated and saved (fixture LLM).
 * The texts checked are the fixture LLM's answers (server/tests/fixtures/llm/{chat,source,
 * card}.json): the card is always 테오. */
export async function saveACharacter(app: ElectronApplication): Promise<void> {
  const win = await app.firstWindow()
  await expect(win.getByText(strings.library.empty)).toBeVisible({ timeout: 45_000 })
  await win.getByRole('button', { name: strings.library.newBook }).click()
  await win.getByLabel(strings.newBook.label).fill('안개의 항구')
  await win.getByRole('button', { name: strings.newBook.create, exact: true }).click()
  await expect(win.getByRole('heading', { name: strings.contents.heading })).toBeVisible()

  // To the dex by its post-it, then a new character in the drawer.
  await win
    .getByRole('navigation', { name: strings.book.sections })
    .getByRole('button', { name: strings.book.notes.characters })
    .click()
  await win.getByRole('button', { name: strings.dex.newCard }).click()
  const drawer = win.getByRole('dialog')
  await expect(
    drawer.getByText(`${strings.drawer.kind.character} · ${strings.drawer.new}`),
  ).toBeVisible()

  // A turn of chat: the AI answers and tidies it into the source notes.
  const input = drawer.getByLabel(strings.drawer.inputLabel)
  await expect(input).toBeEnabled({ timeout: 15_000 })
  await input.fill('테오는 북부 항구 출신이고 소꿉친구 미라와 함께 수도로 떠나.')
  await drawer.getByRole('button', { name: strings.drawer.send }).click()
  await expect(drawer.getByText('미라와는 언제부터 알고 지냈는지도', { exact: false })).toBeVisible(
    {
      timeout: 15_000,
    },
  )
  await expect(drawer.getByText('테오는 소꿉친구 미라와 함께 수도로 떠난다.')).toBeVisible({
    timeout: 15_000,
  })

  // The card is generated from the notes, then saved.
  await drawer.getByRole('button', { name: strings.preview.generate }).click()
  await expect(drawer.getByText('잃어버린 가족을 찾는 귀환자')).toBeVisible({ timeout: 30_000 })
  await drawer.getByRole('button', { name: strings.preview.save, exact: true }).click()
  await expect(win.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

  // It stands in the dex, and turns over to the fields it was saved with.
  const card = win.getByRole('button', { name: strings.dex.flip('테오') })
  await expect(card).toBeVisible()
  await card.click()
  await expect(win.getByText('짧고 건조한 반말')).toBeVisible()
}

/** The sample work in the data dir (§4), as `scripts/seed_academy.py` makes it. */
export function seedAcademy(dataDir: string): void {
  const server = resolve(__dirname, '../../../server')
  execFileSync(join(server, '.venv/Scripts/python.exe'), ['scripts/seed_academy.py', dataDir], {
    cwd: server,
    stdio: 'pipe',
  })
}

/** §20 step 5: in the sample work (its one 5-stage episode: the fixture scenes are 5-stage),
 * plan an episode, then pick a card, direct and confirm each of its scenes. */
export async function directAnEpisode(app: ElectronApplication): Promise<void> {
  const win = await app.firstWindow()
  await win
    .getByRole('button', { name: /이름 없는 기사의 노래/ })
    .first()
    .click({ timeout: 45_000 })
  const notes = win.getByRole('navigation', { name: strings.book.sections })

  await notes.getByRole('button', { name: strings.book.notes.story }).click()
  await win.getByRole('button', { name: strings.stageLock.start }).first().click()
  const lock = win.getByRole('alertdialog')
  await lock.getByRole('button', { name: strings.stageLock.start }).click({ timeout: 15_000 })
  await expect(lock).toHaveCount(0, { timeout: 15_000 })
  await notes.getByRole('button', { name: strings.book.notes.direction }).click()

  const episodes = win.getByRole('navigation', { name: strings.direction.episodes })
  const episode = episodes.getByRole('button', { name: /첫 비극/ })
  await episode.click()
  await win.getByRole('button', { name: strings.direction.make }).click()
  const timeline = win.getByRole('group', { name: strings.direction.timeline })
  await expect(timeline).toBeVisible({ timeout: 30_000 })

  const told = timeline.locator('.dual-row').nth(1).locator('.timeline-scene')
  const scenes = await told.count()
  expect(scenes).toBeGreaterThan(0)
  for (let at = 0; at < scenes; at += 1) {
    await told.nth(at).click()
    await win.keyboard.press('1')
    await win.getByRole('button', { name: strings.direction.directScene }).click()
    const confirm = win.getByRole('button', { name: strings.direction.confirmScene })
    await expect(confirm).toBeEnabled({ timeout: 30_000 })
    await confirm.click()
    await expect(win.getByRole('button', { name: strings.direction.confirmed })).toBeVisible()
  }
  await expect(episode).toContainText(strings.direction.rowConfirmed)
  await expect(win.getByText(strings.direction.confirmedOf(scenes, scenes))).toBeVisible()
}
