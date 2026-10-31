import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerState } from '../src/api/bridge'
import { TypeSection } from '../src/components/TypeSection'
import { useServer } from '../src/stores/server'
import { strings } from '../src/strings'
import type { CardOutput, FiveStageStructure } from '../src/types'

const READY: ServerState = {
  status: 'ready',
  baseUrl: 'http://127.0.0.1:9100',
  token: 'tok',
  restarts: 0,
}

function show(card: CardOutput, onStructure = vi.fn(), cardId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TypeSection
        workId="w_1"
        cardId={cardId}
        card={card}
        structure={null}
        busy={false}
        onStructure={onStructure}
      />
    </QueryClientProvider>,
  )
  return onStructure
}

const STAGES: FiveStageStructure['stages'] = [
  { name: '발단', summary: '발단 요약', tension: 1 },
  { name: '전개', summary: '전개 요약', tension: 2 },
  { name: '위기', summary: '위기 요약', tension: 3 },
  { name: '절정', summary: '절정 요약', tension: 5 },
  { name: '결말', summary: '결말 요약', tension: 2 },
]

beforeEach(() => {
  useServer.setState({ state: READY })
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            milestones: [
              { id: 'ms_a', order: 1, text: '귀환', parts: ['c_p1'], episodes: [] },
              { id: 'ms_b', order: 2, text: '배신', parts: ['c_p2'], episodes: [] },
              { id: 'ms_c', order: 3, text: '결전', parts: [], episodes: [] },
            ],
            foreshadowing: [],
            incomplete: [],
          }),
        ),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a world card shows its rules with exceptions and its terms', () => {
  show({
    type: 'world',
    name: '조수 마법',
    data: {
      category: 'rule',
      summary: '바닷물로 쓰는 마법',
      details: null,
      rules: [
        { rule: '조수 마법은 바닷물이 닿는 곳에서만 쓴다.', exception: '썰물 때는 약해진다.' },
        { rule: '쓰면 체온을 잃는다.', exception: null },
      ],
      terms: [{ term: '마직', meaning: '조수 마법사' }],
      related: [],
    },
    evidence: {},
    ai_guess: [],
  })
  expect(screen.getByText('조수 마법은 바닷물이 닿는 곳에서만 쓴다.')).toBeTruthy()
  expect(screen.getByText('썰물 때는 약해진다.', { exact: false })).toBeTruthy()
  expect(screen.getAllByText(strings.typeSection.exception)).toHaveLength(1)
  expect(screen.getByText('마직')).toBeTruthy()
  expect(screen.getByText('조수 마법사')).toBeTruthy()
})

test('a character shows its voice as lines', () => {
  show({
    type: 'character',
    name: '테오',
    data: {
      theme: null,
      personality: { traits: [], behaviors: [] },
      speech: { description: '짧은 반말', examples: ['됐어.', '가자.'] },
      appearance: { summary: null, details: null },
      relations: [],
      origin_region_id: null,
    },
    evidence: {},
    ai_guess: [],
  })
  expect(screen.getByText('짧은 반말')).toBeTruthy()
  expect(screen.getAllByText('테오')).toHaveLength(2)
  expect(screen.getByText('가자.').tagName).toBe('Q')
})

test('the stage count: the generated one is recommended, the other regenerates', () => {
  const onStructure = show({
    type: 'episode',
    name: '1화',
    data: {
      part_id: null,
      order: null,
      theme: null,
      relation_to_main: null,
      fulfills: [],
      characters: [],
      locations: { main: null, others: [] },
      world: [],
      links: { prev: null, next: null, causes: [] },
      foreshadowing: { plants: [], payoffs: [] },
      worldline_id: null,
      structure: { type: 5, stages: STAGES },
      synopsis: null,
    },
    evidence: {},
    ai_guess: [],
  })
  const group = screen.getByRole('group', { name: strings.typeSection.structure })
  const five = within(group).getByRole('button', { name: /5단계/ })
  expect(five.getAttribute('aria-pressed')).toBe('true')
  expect(within(five).getByText(strings.typeSection.recommended)).toBeTruthy()
  fireEvent.click(five)
  expect(onStructure).not.toHaveBeenCalled()
  fireEvent.click(within(group).getByRole('button', { name: /4단계/ }))
  expect(onStructure).toHaveBeenCalledWith(4)
})

test('a part shows which milestones it takes, which others take, which none', async () => {
  show(
    {
      type: 'part',
      name: '1부',
      data: {
        order: 1,
        title: '귀환',
        theme: null,
        fulfills: ['ms_a'],
        start: null,
        end: null,
        structure: null,
      },
      evidence: {},
      ai_guess: [],
    },
    vi.fn(),
    'c_p1',
  )
  const row = async (text: string) => (await screen.findByText(text)).closest('li') as HTMLElement
  expect(within(await row('귀환')).getByText(strings.typeSection.thisPart)).toBeTruthy()
  expect(within(await row('배신')).getByText(strings.typeSection.otherPart)).toBeTruthy()
  expect(within(await row('결전')).getByText(strings.typeSection.unassigned)).toBeTruthy()
  expect(screen.getByText(strings.typeSection.noStructure)).toBeTruthy()
})

test('milestones say when they are loading or failed, never that there are none', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
  )
  show({
    type: 'part',
    name: '1부',
    data: {
      order: 1,
      title: null,
      theme: null,
      fulfills: [],
      start: null,
      end: null,
      structure: null,
    },
    evidence: {},
    ai_guess: [],
  })
  expect(screen.getByText(strings.typeSection.loadingMilestones)).toBeTruthy()
  expect(await screen.findByText(strings.typeSection.milestonesFailed)).toBeTruthy()
  expect(screen.queryByText(strings.typeSection.noMilestones)).toBeNull()
})
