import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Above the 5 s async waits in tests/setup.ts, so a slow wait fails with its own message.
    testTimeout: 20_000,
  },
})
