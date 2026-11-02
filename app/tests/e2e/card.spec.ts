import { expect, test } from '@playwright/test'
import { strings } from '../../src/strings'
import { withApp } from './app'

// §19 E2E: library → contents → a card talked over, generated and saved (fixture LLM). The
// texts checked below are the fixture LLM's answers (server/tests/fixtures/llm/{chat,source,
// card}.json): the card is always 테오.
test('a character is talked over, generated and saved into the dex', async () => {
  // Server start, a chat turn and a generation each have their own wait below; together they
  // may run past the default 60s on a slow runner.
  test.setTimeout(120_000)
  await withApp(async (app) => {
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
    await expect(
      drawer.getByText('미라와는 언제부터 알고 지냈는지도', { exact: false }),
    ).toBeVisible({
      timeout: 15_000,
    })
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
  })
})
