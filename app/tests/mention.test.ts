import { expect, test } from 'vitest'
import { mentions } from '../src/components/mention'

test('an @name counts alone, before punctuation or a space', () => {
  expect(mentions('@레오', '레오')).toBe(true)
  expect(mentions('친구는 @레오.', '레오')).toBe(true)
  expect(mentions('@레오, 미라', '레오')).toBe(true)
  expect(mentions('「@레오」', '레오')).toBe(true)
})

test('an @name counts with a particle after it, stacked ones too', () => {
  expect(mentions('@레오가 검을 들었다.', '레오')).toBe(true)
  expect(mentions('@레오에게는 비밀이다.', '레오')).toBe(true)
  expect(mentions('@레오이다.', '레오')).toBe(true)
  expect(mentions('@레몬 숲으로 간다.', '레몬 숲')).toBe(true)
  expect(mentions('@레오처럼까지', '레오')).toBe(true)
})

test('an @name inside a longer name never counts', () => {
  expect(mentions('@레오나', '레오')).toBe(false)
  expect(mentions('@레오나와 만난다.', '레오')).toBe(false)
  expect(mentions('@레오12', '레오')).toBe(false)
  expect(mentions('레오가 왔다.', '레오')).toBe(false)
  // A later whole mention still counts.
  expect(mentions('@레오나와 @레오가', '레오')).toBe(true)
})

test('names with regex characters are matched as they are', () => {
  expect(mentions('@A.B가', 'A.B')).toBe(true)
  expect(mentions('@AxB가', 'A.B')).toBe(false)
})
