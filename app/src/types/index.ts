/* GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit. */

/**
 * Saved card (§15), discriminated by type. Card fields are never edited directly (§6).
 */
export type Card = CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard
export type CardId = string
export type WorkId = string
/**
 * incomplete = any §15 required field missing; computed by the server.
 */
export type CardStatus = 'complete' | 'incomplete'
export type MilestoneId = string
export type ForeshadowingId = string
export type WorldlineId = string

export interface CharacterCard {
  id: CardId
  work_id: WorkId
  type: 'character'
  name: string | null
  status: CardStatus
  source_notes: string
  data: CharacterData
  evidence: CardEvidence
  /**
   * Field paths filled without evidence (shown as AI 추정).
   */
  ai_guess: string[]
  /**
   * Field paths kept across regeneration.
   */
  pinned: string[]
  schema_version: number
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
  name: string | null
  status: CardStatus
  source_notes: string
  data: RegionData
  evidence: CardEvidence
  /**
   * Field paths filled without evidence (shown as AI 추정).
   */
  ai_guess: string[]
  /**
   * Field paths kept across regeneration.
   */
  pinned: string[]
  schema_version: number
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
  name: string | null
  status: CardStatus
  source_notes: string
  data: MainStoryData
  evidence: CardEvidence
  /**
   * Field paths filled without evidence (shown as AI 추정).
   */
  ai_guess: string[]
  /**
   * Field paths kept across regeneration.
   */
  pinned: string[]
  schema_version: number
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
  name: string | null
  status: CardStatus
  source_notes: string
  data: PartData
  evidence: CardEvidence
  /**
   * Field paths filled without evidence (shown as AI 추정).
   */
  ai_guess: string[]
  /**
   * Field paths kept across regeneration.
   */
  pinned: string[]
  schema_version: number
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
/**
 * Narrative structure (§7): 5-stage 발단·전개·위기·절정·결말 or 4-stage 기승전결.
 */
export interface StoryStructure {
  type: 4 | 5
  stages: StructureStage[]
}
export interface StructureStage {
  name: '발단' | '전개' | '위기' | '절정' | '결말' | '기' | '승' | '전' | '결'
  summary: string | null
  tension: number | null
}
export interface EpisodeCard {
  id: CardId
  work_id: WorkId
  type: 'episode'
  name: string | null
  status: CardStatus
  source_notes: string
  data: EpisodeData
  evidence: CardEvidence
  /**
   * Field paths filled without evidence (shown as AI 추정).
   */
  ai_guess: string[]
  /**
   * Field paths kept across regeneration.
   */
  pinned: string[]
  schema_version: number
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
