import { expect, test } from 'vitest'
import { TITLE_MAX, cleanTitle, titleLength, titleTooLong } from '../src/components/workTitle'

test('whitespace runs collapse to one space and the ends are trimmed, as on the server', () => {
  expect(cleanTitle('  안개 낀 \t\n 항구  ')).toBe('안개 낀 항구')
  // Python's str.split() whitespace: ideographic space, NEL and the separators U+001C-U+001F.
  expect(cleanTitle('안개\u3000항구\u0085끝\u001f')).toBe('안개 항구 끝')
  // U+FEFF is no whitespace to Python (JS \s would take it).
  expect(cleanTitle('안개\ufeff항구')).toBe('안개\ufeff항구')
  expect(cleanTitle(' \u3000\t')).toBe('')
})

test('length counts code points: an emoji is one, as in Python', () => {
  expect(titleLength('📚')).toBe(1)
  expect(titleLength('안개 📚')).toBe(4)
  const emoji = '📚'.repeat(TITLE_MAX)
  // 200 UTF-16 units, 100 code points.
  expect(emoji.length).toBe(200)
  expect(titleTooLong(cleanTitle(emoji))).toBe(false)
  expect(titleTooLong(cleanTitle(`${emoji}📚`))).toBe(true)
})

test('inner spaces count once after collapsing', () => {
  // 50 + 5 spaces + 49: 104 typed, 100 once cleaned.
  const typed = `${'가'.repeat(50)}     ${'가'.repeat(49)}`
  expect(titleTooLong(cleanTitle(typed))).toBe(false)
  expect(titleTooLong(cleanTitle(`${typed}가`))).toBe(true)
})
