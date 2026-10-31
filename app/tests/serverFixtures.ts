import type { AiplotBridge } from '../src/api/bridge'
import type { HealthResponse, SetupStatus } from '../src/types'

// /health and /setup as a server running the fixture LLM answers them: no first-run screen.
export const FAKE_HEALTH: HealthResponse = {
  status: 'ok',
  llama: { state: 'fake', profile: null, restarts: 0, message: null },
  vram: null,
}

export const SETUP_IDLE: SetupStatus = {
  items: [],
  remaining_bytes: 0,
  free_bytes: 0,
  job_id: null,
}

export const NO_DIALOGS: AiplotBridge['dialog'] = {
  pickModel: () => Promise.resolve(null),
  pickFolder: () => Promise.resolve(null),
}
