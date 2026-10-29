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
/**
 * `card` role output (§13) for the requested type. Evidence indexes refer to the [n]-numbered note sentences in the prompt; the server drops out-of-range indexes and restores pinned fields.
 */
export type CardOutput =
  CharacterCardOutput | RegionCardOutput | MainStoryCardOutput | PartCardOutput | EpisodeCardOutput

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
 * Field path (e.g. personality.traits) -> indexes of supporting source-note sentences.
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
 * GET /health. Model and VRAM fields arrive with the llama process (step 1, unit 6).
 */
export interface HealthResponse {
  status: 'ok'
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
   * Full rewritten source notes; reversals resolved.
   */
  notes: string
  /**
   * Follow-up questions for missing or ambiguous information.
   *
   * @maxItems 3
   */
  questions: string[]
  /**
   * Names in the notes that may be an existing card spelled differently (레오/래오).
   */
  similar_names: SimilarName[]
}
export interface SimilarName {
  mentioned: string
  card_id: CardId
}
