import { useServer } from '../stores/server'
import type { ApiError, WorkList } from '../types'

const API_PREFIX = '/api/v1'

/** A non-2xx answer; code maps to a UI state (§16). */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly hint: string | null

  constructor(status: number, body: ApiError) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.hint = body.hint
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const server = useServer.getState().state
  if (server?.status !== 'ready') {
    throw new ApiRequestError(0, {
      code: 'SERVER_NOT_READY',
      message: 'server not ready',
      hint: null,
    })
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${server.token}`)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${server.baseUrl}${API_PREFIX}${path}`, { ...init, headers })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      isApiError(body)
        ? body
        : { code: `HTTP_${String(response.status)}`, message: response.statusText, hint: null },
    )
  }
  // The server validates its responses against the same generated schemas.
  return body as T
}

export const api = {
  listWorks: () => request<WorkList>('/works'),
}
