import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ChatPanel, type PendingTurn } from '../src/components/ChatPanel'
import type { DraftTurn } from '../src/types'

function show(turns: DraftTurn[], pending: PendingTurn | null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatPanel
        workId="w_1"
        turns={turns}
        pending={pending}
        stage="replying"
        locked={false}
        error={null}
        onSend={() => Promise.resolve(true)}
      />
    </QueryClientProvider>,
  )
}

test('a turn still arriving shows once, from what was sent', () => {
  show([], { user: '테오는 북부 출신이야.', reply: '어떤 곳인가요?', from: 0 })
  expect(screen.getAllByText('테오는 북부 출신이야.')).toHaveLength(1)
  expect(screen.getAllByText('어떤 곳인가요?')).toHaveLength(1)
})

test('a draft that already holds the turn shows it once, not again from what was sent', () => {
  // The draft was refetched after the server kept the turn, before the client heard `replied`.
  show(
    [
      { role: 'user', text: '테오는 북부 출신이야.' },
      { role: 'ai', text: '어떤 곳인가요?' },
    ],
    { user: '테오는 북부 출신이야.', reply: '어떤 곳인가요?', from: 0 },
  )
  expect(screen.getAllByText('테오는 북부 출신이야.')).toHaveLength(1)
  expect(screen.getAllByText('어떤 곳인가요?')).toHaveLength(1)
})
