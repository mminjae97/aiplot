/* GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit. */

/**
 * Saved card (§15), discriminated by type. Card fields are never edited directly (§6).
 */
export type Card = CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard
export type CardId = string
export type WorkId = string
export type CardName = string | null
/**
 * incomplete = any §15 required field missing; computed by the server.
 */
export type CardStatus = 'complete' | 'incomplete'
export type SourceNotes = string
/**
 * Field paths filled without evidence (shown as AI 추정).
 */
export type AiGuessFields = string[]
/**
 * Field paths kept across regeneration.
 */
export type PinnedFields = string[]
export type SchemaVersion = number
export type MilestoneId = string
/**
 * Narrative structure (§7): 5-stage 발단·전개·위기·절정·결말 or 4-stage 기승전결.
 */
export type StoryStructure = FourStageStructure | FiveStageStructure
export type ForeshadowingId = string
export type WorldlineId = string
export type JobId = string
/**
 * data of the SSE events every job can send on GET /jobs/{jobId}/events; the SSE event name is the type (§16). Job kinds add their own events (e.g. chapter: beat_start, sentence).
 */
export type JobLifecycleEvent =
  | JobProgressEvent
  | JobPausedEvent
  | JobResumedEvent
  | JobDoneEvent
  | JobErrorEvent
  | JobCancelledEvent
/**
 * `card` role output (§13). The server constrains and validates with the variant for the requested type. Evidence indexes are the 0-based [n] numbers of the server-split note sentences in the prompt. The server then drops out-of-range indexes, unknown field paths and unknown card ids, assigns ms_/fs_ ids, sets placement fields from context and restores pinned fields (§13).
 */
export type CardOutput =
  CharacterCardOutput | RegionCardOutput | MainStoryCardOutput | PartCardOutput | EpisodeCardOutput
/**
 * Shown on the spine and cover; the server trims it.
 */
export type WorkTitle = string

export interface CharacterCard {
  id: CardId
  work_id: WorkId
  type: 'character'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: CharacterData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
}
/**
 * Character card data (§7, §15). Every key is present; undecided values are null or [].
 */
export interface CharacterData {
  theme: string | null
  personality: CharacterPersonality
  speech: CharacterSpeech
  appearance: CharacterAppearance
  relations: CharacterRelation[]
  origin_region_id: CardId | null
}
export interface CharacterPersonality {
  traits: string[]
  behaviors: CharacterBehavior[]
}
export interface CharacterBehavior {
  situation: string
  action: string
}
export interface CharacterSpeech {
  description: string | null
  /**
   * @maxItems 5
   */
  examples: string[]
}
export interface CharacterAppearance {
  summary: string | null
  details: string | null
}
export interface CharacterRelation {
  target_id: CardId
  relation: string
}
/**
 * Field path (e.g. personality.traits) -> 0-based indexes of supporting source-note sentences (server split).
 */
export interface CardEvidence {
  [k: string]: number[] | undefined
}
export interface RegionCard {
  id: CardId
  work_id: WorkId
  type: 'region'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: RegionData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
  position: RegionPosition | null
}
/**
 * Region card data (§7, §15). Map position is not data; see RegionPosition.
 */
export interface RegionData {
  parent_id: CardId | null
  links: RegionLink[]
  appearance: string | null
  environment: RegionEnvironment
  sensory: RegionSensory
}
export interface RegionLink {
  target_id: CardId
  /**
   * Evidence for the impossible-travel check (§10).
   */
  travel: RegionTravel | null
  direction: string | null
}
export interface RegionTravel {
  value: number
  unit: 'minute' | 'hour' | 'day'
  mode: string | null
}
export interface RegionEnvironment {
  natural: string | null
  social: string | null
}
export interface RegionSensory {
  smell: string | null
  sound: string | null
  mood: string | null
}
/**
 * Region map position (§8): the only directly editable card values; PATCH /cards/{cardId} body.
 */
export interface RegionPosition {
  map_x: number
  map_y: number
}
export interface MainStoryCard {
  id: CardId
  work_id: WorkId
  type: 'main_story'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: MainStoryData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
}
/**
 * Main story card data (§7, §15).
 */
export interface MainStoryData {
  theme: string | null
  premise: string | null
  ending: string | null
  milestones: Milestone[]
}
export interface Milestone {
  id: MilestoneId
  order: number
  text: string
}
export interface PartCard {
  id: CardId
  work_id: WorkId
  type: 'part'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: PartData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
}
/**
 * Part card data (§7, §15).
 */
export interface PartData {
  order: number | null
  title: string | null
  theme: string | null
  fulfills: MilestoneId[]
  start: string | null
  end: string | null
  structure: StoryStructure | null
}
export interface FourStageStructure {
  type: 4
  /**
   * One entry per stage, in story order; names unique (checked by the server).
   *
   * @minItems 4
   * @maxItems 4
   */
  stages: [FourStage, FourStage, FourStage, FourStage, ...FourStage[]]
}
export interface FourStage {
  name: '기' | '승' | '전' | '결'
  summary: string | null
  tension: number | null
}
export interface FiveStageStructure {
  type: 5
  /**
   * One entry per stage, in story order; names unique (checked by the server).
   *
   * @minItems 5
   * @maxItems 5
   */
  stages: [FiveStage, FiveStage, FiveStage, FiveStage, FiveStage, ...FiveStage[]]
}
export interface FiveStage {
  name: '발단' | '전개' | '위기' | '절정' | '결말'
  summary: string | null
  tension: number | null
}
export interface EpisodeCard {
  id: CardId
  work_id: WorkId
  type: 'episode'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: EpisodeData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
}
/**
 * Episode card data (§7, §15).
 */
export interface EpisodeData {
  part_id: CardId | null
  order: number | null
  theme: string | null
  relation_to_main: string | null
  fulfills: MilestoneId[]
  characters: CardId[]
  locations: EpisodeLocations
  links: EpisodeLinks
  foreshadowing: EpisodeForeshadowing
  worldline_id: WorldlineId | null
  structure: StoryStructure | null
  synopsis: string | null
}
export interface EpisodeLocations {
  main: CardId | null
  others: CardId[]
}
export interface EpisodeLinks {
  prev: CardId | null
  next: CardId | null
  causes: CardId[]
}
export interface EpisodeForeshadowing {
  plants: ForeshadowingPlant[]
  /**
   * Ids of foreshadowing planted in other episodes and paid off here.
   */
  payoffs: ForeshadowingId[]
}
export interface ForeshadowingPlant {
  id: ForeshadowingId
  text: string
}
/**
 * Error body for every non-2xx API response; each code maps to a UI state (§16).
 */
export interface ApiError {
  code: string
  message: string
  hint: string | null
}
/**
 * GET /health. The server is up whenever this answers; llama says whether the model can be used (missing files → S0-1 first run, §12, §13).
 */
export interface HealthResponse {
  status: 'ok'
  llama: LlamaHealth
  /**
   * From nvidia-smi; null when it cannot be read.
   */
  vram: VramUsage | null
}
export interface LlamaHealth {
  /**
   * fake: AIPLOT_FAKE_LLM=1 fixtures, no model. missing_binary / missing_model: first run or files removed. starting: process up, model loading. ready: usable. error: stopped after 3 restarts or a start failure; message says why.
   */
  state: 'fake' | 'missing_binary' | 'missing_model' | 'starting' | 'ready' | 'error' | 'stopped'
  /**
   * Base profile id in use (config/profiles).
   */
  profile: string | null
  /**
   * Restarts of an unresponsive or crashed llama-server in this session (at most 3).
   */
  restarts: number
  message: string | null
}
export interface VramUsage {
  used_mb: number
  total_mb: number
}
/**
 * event: progress. Units are the job's own (beats, bytes).
 */
export interface JobProgressEvent {
  done: number
  total: number
  /**
   * Estimated seconds left; null until there is enough progress to estimate.
   */
  etaSec: number | null
  /**
   * What runs now, e.g. a file name.
   */
  step: string | null
}
/**
 * event: paused. Pause takes effect at the job's next checkpoint (beat granularity).
 */
export interface JobPausedEvent {
  reason: 'user'
}
/**
 * event: resumed.
 */
export interface JobResumedEvent {}
/**
 * event: done. Last event of a successful job; result is job-specific.
 */
export interface JobDoneEvent {
  result: {
    [k: string]: unknown | undefined
  }
}
/**
 * event: error. Last event of a failed job; code maps to a UI state like ApiError.code.
 */
export interface JobErrorEvent {
  code: string
  message: string
}
/**
 * event: cancelled. Last event of a cancelled job.
 */
export interface JobCancelledEvent {}
/**
 * 202 body of every endpoint that starts a job (§16).
 */
export interface JobAccepted {
  jobId: JobId
}
/**
 * GET /works/{workId}/jobs: that work's jobs still in server memory, newest first.
 */
export interface JobList {
  jobs: Job[]
}
/**
 * GET /jobs/{jobId}. Work over ~10 s runs as a job (§5, §13); jobs live in server memory, results in the DB. Keys are camelCase (§5, §16).
 */
export interface Job {
  jobId: JobId
  /**
   * What the job does, e.g. chapter, plan, download.
   */
  kind: string
  workId: WorkId | null
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  /**
   * ISO 8601 UTC.
   */
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /**
   * Id of the newest event; pass it as Last-Event-ID to resume the stream.
   */
  lastEventId: number
  error: JobErrorEvent | null
}
/**
 * lora/{id}.json beside the adapter in the data dir. Written by training/, read by the server LoRA registry, which never loads an adapter whose base_sha256 differs from the profile's GGUF (§13).
 */
export interface LoraManifest {
  id: string
  /**
   * Adapter file name in the same folder.
   */
  file: string
  sha256: string
  /**
   * sha256 of the base GGUF the adapter was trained for.
   */
  base_sha256: string
}
export interface CharacterCardOutput {
  type: 'character'
  name: CardName
  data: CharacterData
  evidence: CardEvidence
  ai_guess: AiGuessFields
}
export interface RegionCardOutput {
  type: 'region'
  name: CardName
  data: RegionData
  evidence: CardEvidence
  ai_guess: AiGuessFields
}
export interface MainStoryCardOutput {
  type: 'main_story'
  name: CardName
  data: MainStoryData
  evidence: CardEvidence
  ai_guess: AiGuessFields
}
export interface PartCardOutput {
  type: 'part'
  name: CardName
  data: PartData
  evidence: CardEvidence
  ai_guess: AiGuessFields
}
export interface EpisodeCardOutput {
  type: 'episode'
  name: CardName
  data: EpisodeData
  evidence: CardEvidence
  ai_guess: AiGuessFields
}
/**
 * `source` role output (§13). Changed sentences are computed by the server (sentence diff), not by the model.
 */
export interface SourceOutput {
  /**
   * Full rewritten source notes; reversals resolved. Server rejects an empty result when previous notes were non-empty.
   */
  notes: string
  /**
   * Follow-up questions for missing or ambiguous information.
   *
   * @maxItems 3
   */
  questions: string[]
  /**
   * Pairs of names that may be one entity spelled differently (레오/래오), within the notes or against existing cards.
   */
  similar_names: SimilarName[]
}
export interface SimilarName {
  mentioned: string
  similar_to: string
  /**
   * Existing card named similar_to, or null if it is only in the notes.
   */
  card_id: CardId | null
}
/**
 * PUT /setup/paths: use files the user already has instead of downloading. Send both keys; null means the default location under the data dir, and a value equal to the current one is kept without a new check. Starts a job that checks changed paths (model: size + sha256 against the profile; llama: `--version` reports the pinned build) before they are used.
 */
export interface SetupPathsRequest {
  /**
   * Full path of the base GGUF file.
   */
  model_path: string | null
  /**
   * Folder that holds llama-server.exe and its DLLs.
   */
  llama_dir: string | null
}
/**
 * GET /setup: what the first-run screen (S0-1) needs. Files are downloaded at first run, never shipped (§2, §6).
 */
export interface SetupStatus {
  items: SetupItem[]
  /**
   * Still to download for everything not installed.
   */
  remaining_bytes: number
  /**
   * Free space on the data dir's drive.
   */
  free_bytes: number
  /**
   * Download or path check running now, if any.
   */
  job_id: JobId | null
}
export interface SetupItem {
  /**
   * llama: llama.cpp server build. model: base GGUF.
   */
  id: 'llama' | 'model'
  /**
   * installed: usable. partial: a resumable download is on disk. missing: nothing yet.
   */
  status: 'installed' | 'partial' | 'missing'
  /**
   * Where the server looks (default under the data dir, or the path the user set).
   */
  path: string
  /**
   * True when the user pointed to an existing file or folder.
   */
  custom: boolean
  /**
   * Download size (llama: both archives).
   */
  total_bytes: number
  present_bytes: number
}
/**
 * POST /works: "새로 만들기" asks for the title only (§12 S0).
 */
export interface WorkCreate {
  /**
   * Raw input: the server collapses whitespace, then requires 1..100 chars (TITLE_EMPTY, TITLE_TOO_LONG).
   */
  title: string
}
/**
 * GET /works: every book, most recently modified first (§12 S0).
 */
export interface WorkList {
  works: Work[]
}
/**
 * A book in the library (§12 S0, §14 work). Fields for the cover (main theme, chapters) arrive with the units that create them.
 */
export interface Work {
  id: WorkId
  title: WorkTitle
  /**
   * 1 planning, 2 direction, 3 writing (§1).
   */
  stage: 1 | 2 | 3
  /**
   * Highest read-only stage; 0 = none (§11).
   */
  locked_stage: 0 | 1 | 2
  /**
   * Contents item opened last, highlighted on S1 (§12).
   */
  last_item:
    ('world' | 'characters' | 'regions' | 'story' | 'direction' | 'writing' | 'reading') | null
  /**
   * ISO 8601 UTC.
   */
  updated_at: string
}
