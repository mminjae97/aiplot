import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ARRIVAL_MS, ARRIVAL_WAIT_MS, useArrival } from '../src/components/useArrival'

let node: HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers()
  node = document.createElement('button')
  document.body.append(node)
})

afterEach(() => {
  node.remove()
  vi.useRealTimers()
})

function track(onPage: { ids: string[] }) {
  return renderHook(() =>
    useArrival(
      (id) => onPage.ids.includes(id),
      () => node,
    ),
  )
}

test('a card that shows within the wait is highlighted 0.3s and takes the focus', () => {
  const onPage = { ids: [] as string[] }
  const hook = track(onPage)
  act(() => {
    hook.result.current[1]('c_1')
  })
  expect(hook.result.current[0]).toBeNull()
  act(() => {
    vi.advanceTimersByTime(ARRIVAL_WAIT_MS - 100)
  })
  onPage.ids = ['c_1']
  hook.rerender()
  expect(hook.result.current[0]).toBe('c_1')
  expect(document.activeElement).toBe(node)
  // Past the wait while showing: it ends with its own highlight.
  act(() => {
    vi.advanceTimersByTime(ARRIVAL_MS - 1)
  })
  expect(hook.result.current[0]).toBe('c_1')
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(hook.result.current[0]).toBeNull()
})

test('a card not shown within the wait lapses: no late highlight, no focus', () => {
  const onPage = { ids: [] as string[] }
  const hook = track(onPage)
  act(() => {
    hook.result.current[1]('c_1')
  })
  act(() => {
    vi.advanceTimersByTime(ARRIVAL_WAIT_MS)
  })
  // Its step opened much later.
  onPage.ids = ['c_1']
  hook.rerender()
  act(() => {
    vi.runAllTimers()
  })
  expect(hook.result.current[0]).toBeNull()
  expect(document.activeElement).toBe(document.body)
})
