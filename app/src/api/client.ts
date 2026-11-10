import { useServer } from '../stores/server'
import type {
  ApiError,
  BeatEdit,
  Card,
  CardList,
  CardDeleted,
  CardReferences,
  CardRelations,
  RegionLinks,
  Completeness,
  Cover,
  CoverList,
  Draft,
  DraftCreate,
  DraftGenerate,
  DraftStructure,
  HealthResponse,
  Job,
  JobAccepted,
  JobList,
  PlanList,
  PlanRecord,
  Technique,
  TechniqueDevice,
  TechniqueList,
  SetupPathsRequest,
  SetupStatus,
  StageAdvancePreview,
  StageReopen,
  StageReopenPreview,
  Work,
  WorkCreate,
  WorkList,
  WorkUpdate,
} from '../types'

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

export async function send(path: string, init: RequestInit): Promise<Response> {
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

const job = (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`
const draft = (draftId: string) => `/drafts/${encodeURIComponent(draftId)}`

export const api = {
  health: () => request<HealthResponse>('/health'),
  setup: () => request<SetupStatus>('/setup'),
  startDownload: () => request<JobAccepted>('/setup/download', { method: 'POST' }),
  setPaths: (body: SetupPathsRequest) =>
    request<JobAccepted>('/setup/paths', { method: 'PUT', body: JSON.stringify(body) }),
  retryLlama: () => request<null>('/setup/retry', { method: 'POST' }),
  getJob: (jobId: string) => request<Job>(job(jobId)),
  pauseJob: (jobId: string) => request<Job>(`${job(jobId)}/pause`, { method: 'POST' }),
  resumeJob: (jobId: string) => request<Job>(`${job(jobId)}/resume`, { method: 'POST' }),
  cancelJob: (jobId: string) => request<Job>(`${job(jobId)}/cancel`, { method: 'POST' }),
  listWorkJobs: (workId: string) => request<JobList>(`${work(workId)}/jobs`),
  listPlans: (episodeId: string) =>
    request<PlanList>(`/episodes/${encodeURIComponent(episodeId)}/plans`),
  /** PUT .../devices: the user's checked devices; the plan comes back recommended anew. */
  setSceneDevices: (planId: string, scene: number, devices: TechniqueDevice[]) =>
    request<PlanRecord>(`/plans/${encodeURIComponent(planId)}/scenes/${String(scene)}/devices`, {
      method: 'PUT',
      body: JSON.stringify({ devices }),
    }),
  /** POST .../pick: the 1-3 cards to direct the scene with, in order. */
  pickTechniques: (planId: string, scene: number, techniques: string[]) =>
    request<PlanRecord>(`/plans/${encodeURIComponent(planId)}/scenes/${String(scene)}/pick`, {
      method: 'POST',
      body: JSON.stringify({ techniques }),
    }),
  listTechniques: (q: string) => request<TechniqueList>(`/techniques?q=${encodeURIComponent(q)}`),
  getTechnique: (techniqueId: string) =>
    request<Technique>(`/techniques/${encodeURIComponent(techniqueId)}`),
  /** POST .../direct (job): the scene's beats from its chosen cards. */
  directScene: (planId: string, scene: number) =>
    request<JobAccepted>(`/plans/${encodeURIComponent(planId)}/scenes/${String(scene)}/direct`, {
      method: 'POST',
    }),
  /** PUT .../beats: the user's beats; targets rescaled, numbered by the server. */
  setSceneBeats: (planId: string, scene: number, beats: [BeatEdit, ...BeatEdit[]]) =>
    request<PlanRecord>(`/plans/${encodeURIComponent(planId)}/scenes/${String(scene)}/beats`, {
      method: 'PUT',
      body: JSON.stringify({ beats }),
    }),
  confirmScene: (planId: string, scene: number) =>
    request<PlanRecord>(`/plans/${encodeURIComponent(planId)}/scenes/${String(scene)}/confirm`, {
      method: 'POST',
    }),
  /** PATCH /plans/{planId}: the told order and cuts; scenes whose place changed go stale. */
  rearrangePlan: (planId: string, chapters: number[][]) =>
    request<PlanRecord>(`/plans/${encodeURIComponent(planId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ chapters }),
    }),
  /** POST /episodes/{episodeId}/plans (job): replace drops the plan the episode has. */
  createPlan: (episodeId: string, replace: boolean) =>
    request<JobAccepted>(
      `/episodes/${encodeURIComponent(episodeId)}/plans${replace ? '?replace=true' : ''}`,
      { method: 'POST' },
    ),
  listCards: (workId: string, filter: { type?: string; q?: string } = {}) => {
    const query = new URLSearchParams()
    if (filter.type) query.set('type', filter.type)
    if (filter.q) query.set('q', filter.q)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return request<CardList>(`${work(workId)}/cards${suffix}`)
  },
  createDraft: (workId: string, body: DraftCreate) =>
    request<Draft>(`${work(workId)}/drafts`, { method: 'POST', body: JSON.stringify(body) }),
  getDraft: (draftId: string) => request<Draft>(draft(draftId)),
  putSource: (draftId: string, notes: string) =>
    request<Draft>(`${draft(draftId)}/source`, {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    }),
  deleteDraft: (draftId: string) => request<null>(draft(draftId), { method: 'DELETE' }),
  generateCard: (draftId: string, body: DraftGenerate) =>
    request<JobAccepted>(`${draft(draftId)}/generate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** 5→4 on the generated part or episode, in code on the server (§7): no model call. */
  putStructure: (draftId: string, body: DraftStructure) =>
    request<Draft>(`${draft(draftId)}/structure`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  saveDraft: (draftId: string) => request<Card>(`${draft(draftId)}/save`, { method: 'POST' }),
  getCard: (cardId: string) => request<Card>(`/cards/${encodeURIComponent(cardId)}`),
  completeness: (workId: string) => request<Completeness>(`${work(workId)}/completeness`),
  relations: (
    workId: string,
    kind:
      | 'world'
      | 'character'
      | 'origin'
      | 'parent'
      | 'episode_region'
      | 'episode_part'
      | 'episode_link'
      | 'episode_character',
  ) => request<CardRelations>(`${work(workId)}/relations?kind=${kind}`),
  regionLinks: (workId: string) => request<RegionLinks>(`${work(workId)}/region-links`),
  /** PATCH /cards/{cardId}: a region's map position, the only directly edited values (§6). */
  moveRegion: (cardId: string, mapX: number, mapY: number) =>
    request<Card>(`/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ map_x: mapX, map_y: mapY }),
    }),
  /** DELETE /cards/{cardId}; a part with episodes needs `episodes` (move:{partId} | delete). */
  deleteCard: (cardId: string, options: { episodes?: string; reconnect?: boolean } = {}) => {
    const query = new URLSearchParams()
    if (options.episodes) query.set('episodes', options.episodes)
    if (options.reconnect) query.set('reconnect', 'true')
    const search = query.size > 0 ? `?${query.toString()}` : ''
    return request<CardDeleted>(`/cards/${encodeURIComponent(cardId)}${search}`, {
      method: 'DELETE',
    })
  },
  restoreCard: (cardId: string) =>
    request<Card>(`/cards/${encodeURIComponent(cardId)}/restore`, { method: 'POST' }),
  cardReferences: (cardId: string) =>
    request<CardReferences>(`/cards/${encodeURIComponent(cardId)}/references`),
  listWorks: () => request<WorkList>('/works'),
  getWork: (workId: string) => request<Work>(work(workId)),
  createWork: (body: WorkCreate) =>
    request<Work>('/works', { method: 'POST', body: JSON.stringify(body) }),
  deleteWork: (workId: string) => request<null>(work(workId), { method: 'DELETE' }),
  updateWork: (workId: string, body: WorkUpdate) =>
    request<Work>(work(workId), { method: 'PATCH', body: JSON.stringify(body) }),
  advancePreview: (workId: string) =>
    request<StageAdvancePreview>(`${work(workId)}/stage/advance-preview`),
  advanceStage: (workId: string) =>
    request<Work>(`${work(workId)}/stage/advance`, { method: 'POST' }),
  reopenPreview: (workId: string, stage: StageReopen['stage']) =>
    request<StageReopenPreview>(`${work(workId)}/stage/reopen-preview?stage=${String(stage)}`),
  reopenStage: (workId: string, body: StageReopen) =>
    request<Work>(`${work(workId)}/stage/reopen`, { method: 'POST', body: JSON.stringify(body) }),
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
