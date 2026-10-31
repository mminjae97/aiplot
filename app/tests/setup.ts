import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The Windows CI runner can take over a second for a first render with its fetch round
// trips; findBy* and waitFor wait up to 5 s there instead of failing at 1 s.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
})
