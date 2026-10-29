import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import { strings } from '../src/strings'

test('renders app name and empty library message', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: strings.app.name })).toBeTruthy()
  expect(screen.getByText(strings.library.empty)).toBeTruthy()
})
