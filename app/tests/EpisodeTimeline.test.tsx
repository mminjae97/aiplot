import { fireEvent, render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { EpisodeTimeline } from '../src/components/EpisodeTimeline'
import type { Timeline } from '../src/components/storyLayout'

const timeline: Timeline = {
  columns: 30,
  spans: [],
  lanes: [{ id: null, label: '장소 미정', rows: 1 }],
  nodes: [],
  markers: [],
  arrows: [],
  milestoneOf: new Map(),
  milestoneColumns: new Map(),
}

function scroller() {
  const { container } = render(
    <EpisodeTimeline
      timeline={timeline}
      episodes={new Map()}
      milestones={[]}
      selectedPart={null}
      onSelectPart={() => undefined}
      onPick={() => undefined}
    />,
  )
  const box = container.querySelector<HTMLDivElement>('.timeline-scroll')
  if (!box) throw new Error('no timeline')
  // jsdom lays nothing out: a box 400px wide over a story 3500px long.
  Object.defineProperty(box, 'clientWidth', { value: 400 })
  Object.defineProperty(box, 'scrollWidth', { value: 3500 })
  Object.defineProperty(box, 'clientHeight', { value: 300 })
  box.setPointerCapture = () => undefined
  box.releasePointerCapture = () => undefined
  return box
}

test('the wheel runs the story across: down goes on, up goes back', () => {
  const box = scroller()
  fireEvent.wheel(box, { deltaY: 120 })
  expect(box.scrollLeft).toBe(120)
  fireEvent.wheel(box, { deltaY: -50 })
  expect(box.scrollLeft).toBe(70)
  // Ctrl+wheel is left to the browser.
  fireEvent.wheel(box, { deltaY: 100, ctrlKey: true })
  expect(box.scrollLeft).toBe(70)
})

test('dragging the paper moves the view with the pointer', () => {
  const box = scroller()
  box.scrollLeft = 300
  fireEvent.pointerDown(box, { button: 0, clientX: 300, clientY: 200, pointerId: 1 })
  fireEvent.pointerMove(box, { clientX: 180, clientY: 200, pointerId: 1 })
  expect(box.scrollLeft).toBe(420)
  fireEvent.pointerUp(box, { pointerId: 1 })
  fireEvent.pointerMove(box, { clientX: 100, clientY: 200, pointerId: 1 })
  expect(box.scrollLeft).toBe(420)
})

test('pressing the scrollbar is left to the browser, not a drag of the paper', () => {
  const box = scroller()
  box.scrollLeft = 300
  // Below the 300px client area: on the horizontal scrollbar.
  fireEvent.pointerDown(box, { button: 0, clientX: 200, clientY: 305, pointerId: 1 })
  fireEvent.pointerMove(box, { clientX: 100, clientY: 305, pointerId: 1 })
  expect(box.scrollLeft).toBe(300)
})
