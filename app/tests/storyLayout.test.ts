import { expect, test } from 'vitest'
import { timelineOf } from '../src/components/storyLayout'
import type { CardRelation, MilestoneFulfilment } from '../src/types'

const row = (from: string, to: string, relation: string | null = null): CardRelation => ({
  from_id: from,
  to_id: to,
  relation,
})

function layout(extra: { milestones?: MilestoneFulfilment[]; settings?: CardRelation[] } = {}) {
  return timelineOf({
    parts: [
      { id: 'c_p1', label: '제1부' },
      { id: 'c_p2', label: '제2부' },
      { id: 'c_p3', label: '제3부' },
    ],
    placement: [
      row('c_e3', 'c_p1', '2'),
      row('c_e1', 'c_p1', '1'),
      row('c_e2', 'c_p1', '2'),
      row('c_e4', 'c_p2', '1'),
    ],
    settings: extra.settings ?? [
      row('c_e1', 'c_port', 'main'),
      row('c_e2', 'c_port', 'main'),
      row('c_e2', 'c_isle'),
      row('c_e3', 'c_isle', 'main'),
      row('c_e4', 'c_capital', 'main'),
    ],
    links: [
      row('c_e1', 'c_e2', 'order'),
      row('c_e4', 'c_e1', 'cause'),
      row('c_e1', 'c_gone', 'order'),
    ],
    milestones: extra.milestones ?? [],
    regions: new Map([
      ['c_capital', '왕도'],
      ['c_port', '북부 항구'],
      ['c_isle', '등대 섬'],
    ]),
    nowhere: '장소 미정',
  })
}

test('story order across, the same order in a part shares a column, an empty part keeps one', () => {
  const timeline = layout()
  const columnOf = new Map(timeline.nodes.map((node) => [node.episodeId, node.column]))
  expect(columnOf.get('c_e1')).toBe(0)
  expect(columnOf.get('c_e2')).toBe(1)
  expect(columnOf.get('c_e3')).toBe(1)
  expect(columnOf.get('c_e4')).toBe(2)
  expect(timeline.spans).toEqual([
    { partId: 'c_p1', label: '제1부', first: 0, last: 1 },
    { partId: 'c_p2', label: '제2부', first: 2, last: 2 },
    { partId: 'c_p3', label: '제3부', first: 3, last: 3 },
  ])
  expect(timeline.columns).toBe(4)
})

test('a lane per region used, in region order; other places leave markers', () => {
  const timeline = layout()
  expect(timeline.lanes.map((lane) => lane.label)).toEqual(['왕도', '북부 항구', '등대 섬'])
  const laneOf = new Map(timeline.nodes.map((node) => [node.episodeId, node.lane]))
  expect(laneOf.get('c_e4')).toBe(0)
  expect(laneOf.get('c_e1')).toBe(1)
  expect(timeline.markers).toEqual([{ episodeId: 'c_e2', column: 1, lane: 2, row: 0 }])
})

test('episodes without a main place get the 장소 미정 lane', () => {
  const timeline = layout({ settings: [row('c_e1', 'c_port', 'main')] })
  expect(timeline.lanes.map((lane) => lane.label)).toEqual(['북부 항구', '장소 미정'])
  expect(timeline.nodes.find((node) => node.episodeId === 'c_e4')?.lane).toBe(1)
})

test('arrows only between placed episodes, keeping their kind', () => {
  expect(layout().arrows).toEqual([
    { from: 'c_e1', to: 'c_e2', kind: 'order' },
    { from: 'c_e4', to: 'c_e1', kind: 'cause' },
  ])
})

test('an episode takes its first milestone; a milestone sits over its first episode or part', () => {
  const timeline = layout({
    milestones: [
      { id: 'ms_1', order: 1, text: '발견', parts: ['c_p1'], episodes: ['c_e2'] },
      { id: 'ms_2', order: 2, text: '배신', parts: ['c_p2'], episodes: ['c_e2', 'c_e4'] },
      { id: 'ms_3', order: 3, text: '대면', parts: ['c_p3'], episodes: [] },
    ],
  })
  expect(timeline.milestoneOf.get('c_e2')).toBe(0)
  expect(timeline.milestoneOf.get('c_e4')).toBe(1)
  expect([...timeline.milestoneColumns]).toEqual([
    [0, 1],
    [1, 1],
    [2, 3],
  ])
})

test('simultaneous episodes in the same place stack in their cell', () => {
  const timeline = timelineOf({
    parts: [{ id: 'c_p1', label: '제1부' }],
    placement: [row('c_a', 'c_p1', '1'), row('c_b', 'c_p1', '1')],
    settings: [row('c_a', 'c_port', 'main'), row('c_b', 'c_port', 'main')],
    links: [],
    milestones: [],
    regions: new Map([['c_port', '북부 항구']]),
    nowhere: '장소 미정',
  })
  expect(timeline.nodes.map((node) => [node.episodeId, node.column, node.lane, node.row])).toEqual([
    ['c_a', 0, 0, 0],
    ['c_b', 0, 0, 1],
  ])
  expect(timeline.lanes).toEqual([{ id: 'c_port', label: '북부 항구', rows: 2 }])
})
