import { expect, test } from 'vitest'
import { elide, textDiff } from '../src/components/textDiff'

const before = (pieces: ReturnType<typeof textDiff>) =>
  pieces
    .filter((p) => p.kind !== 'added')
    .map((p) => p.text)
    .join('')
const after = (pieces: ReturnType<typeof textDiff>) =>
  pieces
    .filter((p) => p.kind !== 'removed')
    .map((p) => p.text)
    .join('')

test('words dropped and added are told apart, the rest kept as it was', () => {
  const old = '테오는 배에서 뛰어내렸다. 미라가 웃었다.\n\n바람이 불었다.'
  const now = '테오는 배에서 내렸다. 미라가 웃었다.\n\n바람이 세게 불었다.'
  const pieces = textDiff(old, now)
  expect(pieces).toEqual([
    { kind: 'same', text: '테오는 배에서 ' },
    { kind: 'removed', text: '뛰어내렸다.' },
    { kind: 'added', text: '내렸다.' },
    { kind: 'same', text: ' 미라가 웃었다.\n\n바람이' },
    { kind: 'added', text: ' 세게' },
    { kind: 'same', text: ' 불었다.' },
  ])
  expect(before(pieces)).toBe(old)
  expect(after(pieces)).toBe(now)
})

test('the same text is one piece; an empty side is all added or all removed', () => {
  expect(textDiff('같다.', '같다.')).toEqual([{ kind: 'same', text: '같다.' }])
  expect(textDiff('', '새 글.')).toEqual([{ kind: 'added', text: '새 글.' }])
  expect(textDiff('옛 글.', '')).toEqual([{ kind: 'removed', text: '옛 글.' }])
})

test('texts too far apart to compare word by word still join back to both', () => {
  const words = (seed: string) =>
    Array.from({ length: 2000 }, (_, at) => `${seed}${String(at)}`).join(' ')
  const old = words('가')
  const now = words('나')
  const pieces = textDiff(old, now)
  expect(before(pieces)).toBe(old)
  expect(after(pieces)).toBe(now)
})

test('long unchanged runs keep only their ends next to a change', () => {
  const long = '가'.repeat(100)
  const pieces = elide([
    { kind: 'same', text: long },
    { kind: 'added', text: '새 말 ' },
    { kind: 'same', text: long },
    { kind: 'removed', text: '옛 말' },
    { kind: 'same', text: '짧다' },
  ])
  expect(pieces.map((p) => p.text)).toEqual([
    `… ${'가'.repeat(40)}`,
    '새 말 ',
    `${'가'.repeat(40)} … ${'가'.repeat(40)}`,
    '옛 말',
    '짧다',
  ])
  // Nothing changed: nothing cut.
  expect(elide([{ kind: 'same', text: long }])).toEqual([{ kind: 'same', text: long }])
})

test('a line added after a word is the line alone; a rewritten phrase reads as one change', () => {
  expect(textDiff('손이 멈췄다.', '손이 멈췄다.\n덧붙인 문장.')).toEqual([
    { kind: 'same', text: '손이 멈췄다.' },
    { kind: 'added', text: '\n덧붙인 문장.' },
  ])
  expect(textDiff('그는 문을 열고 나갔다.', '그는 창을 깨고 뛰었다.')).toEqual([
    { kind: 'same', text: '그는 ' },
    { kind: 'removed', text: '문을 열고 나갔다.' },
    { kind: 'added', text: '창을 깨고 뛰었다.' },
  ])
})
