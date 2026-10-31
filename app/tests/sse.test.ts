import { expect, test } from 'vitest'
import { type JobEvent, SseParser } from '../src/api/sse'
import { formatBytes, formatEta, percentOf, stepText } from '../src/components/setupText'
import { strings } from '../src/strings'

function parse(chunks: string[]): JobEvent[] {
  const events: JobEvent[] = []
  const parser = new SseParser((event) => events.push(event))
  for (const chunk of chunks) parser.feed(chunk)
  return events
}

test('events carry their id, name and JSON data, split anywhere', () => {
  const text =
    'id: 1\nevent: progress\ndata: {"done":1,"total":4,"etaSec":null,"step":null}\n\n' +
    ': keep-alive\n\n' +
    'id: 2\r\nevent: done\r\ndata: {"result":{}}\r\n\r\n'
  const whole = parse([text])
  expect(whole).toEqual([
    { id: 1, type: 'progress', data: { done: 1, total: 4, etaSec: null, step: null } },
    { id: 2, type: 'done', data: { result: {} } },
  ])
  // Byte by byte gives the same events.
  expect(parse([...Array(text.length).keys()].map((i) => text.charAt(i)))).toEqual(whole)
})

test('multi-line data joins with newlines; an event without data is skipped', () => {
  expect(parse(['event: note\ndata: a\ndata: b\n\nevent: empty\n\n'])).toEqual([
    { id: null, type: 'note', data: 'a\nb' },
  ])
})

test('progress reads in Korean', () => {
  expect(formatBytes(5.9 * 1024 ** 3)).toBe('5.9GB')
  expect(formatBytes(300 * 1024 ** 2)).toBe('300MB')
  expect(formatEta(30)).toBe('1분 미만')
  expect(formatEta(12 * 60)).toBe('약 12분')
  expect(formatEta(2 * 3600)).toBe('약 2시간')
  expect(formatEta(2 * 3600 + 15 * 60)).toBe('약 2시간 15분')
  expect(percentOf(1, 3)).toBe(33)
  expect(percentOf(0, 0)).toBe(0)
  expect(stepText('Qwen3-8B-Uncensored.i1-Q5_K_M.gguf')).toBe(
    strings.setup.downloading(strings.setup.model),
  )
  expect(stepText('verify cudart-llama-bin-win-cuda-13.4-x64.zip')).toBe(
    strings.setup.verifying(strings.setup.llama),
  )
  expect(stepText(null)).toBe(strings.setup.preparing)
})
