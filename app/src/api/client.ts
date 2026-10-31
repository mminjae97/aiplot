import { useServer } from '../stores/server'
import type { ApiError, Cover, CoverList, Work, WorkCreate, WorkList, WorkUpdate } from '../types'

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

async function send(path: string, init: RequestInit): Promise<Response> {
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
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const response = await fetch(`${server.baseUrl}${API_PREFIX}${path}`, { ...init, headers })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiRequestError(
      response.status,
      isApiError(body)
        ? body
        : { code: `HTTP_${String(response.status)}`, message: response.statusText, hint: null },
    )
  }
  return response
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init)
  // 204 has no body.
  const body: unknown = await response.json().catch(() => null)
  // The server validates its responses against the same generated schemas.
  return body as T
}

/** Images need the token too, so they are fetched here and shown from blob: URLs. */
async function requestBlob(path: string): Promise<Blob> {
  return (await send(path, {})).blob()
}

const work = (workId: string) => `/works/${encodeURIComponent(workId)}`

export const api = {
  listWorks: () => request<WorkList>('/works'),
  getWork: (workId: string) => request<Work>(work(workId)),
  createWork: (body: WorkCreate) =>
    request<Work>('/works', { method: 'POST', body: JSON.stringify(body) }),
  deleteWork: (workId: string) => request<null>(work(workId), { method: 'DELETE' }),
  updateWork: (workId: string, body: WorkUpdate) =>
    request<Work>(work(workId), { method: 'PATCH', body: JSON.stringify(body) }),
  listCovers: (workId: string) => request<CoverList>(`${work(workId)}/covers`),
  uploadCover: (workId: string, image: Blob) =>
    request<Cover>(`${work(workId)}/covers`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: image,
    }),
  coverImage: (workId: string, coverId: string) =>
    requestBlob(`${work(workId)}/covers/${encodeURIComponent(coverId)}/image`),
  deleteCover: (workId: string, coverId: string) =>
    request<null>(`${work(workId)}/covers/${encodeURIComponent(coverId)}`, { method: 'DELETE' }),
}
