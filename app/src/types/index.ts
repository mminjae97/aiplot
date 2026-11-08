/* GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit. */

export type CardId = string
/**
 * Saved card (§15), discriminated by type. Card fields are never edited directly (§6).
 */
export type Card = WorldCard | CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard
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
export type CoverId = string
export type DraftId = string
export type JobId = string
export type PlanId = string
export type TechniqueId = string
/**
 * How much detail a beat gives (§9), independent of its focus.
 */
export type BeatDensity = '담백' | '자세히'
/**
 * What a beat dwells on (§9).
 */
export type BeatFocus = '감정' | '행동' | '정보'
/**
 * How a beat is narrated (§9): 장면화 shows it moment by moment, 요약 tells it in brief.
 */
export type BeatMode = '장면화' | '요약'
/**
 * A direction plan's state (§9, §14): directing until every scene is confirmed, then confirmed.
 */
export type PlanStatus = 'directing' | 'confirmed'
/**
 * A plan scene's direction state (§9): undirected (no beats yet), directed, stale (its place or neighbours changed after it was directed: direct again), confirmed.
 */
export type SceneStatus = 'undirected' | 'directed' | 'stale' | 'confirmed'
/**
 * Fixed scene devices (§9): what a scene does with information, time, talk or people, observable in its summary. A scene answers each yes or no; a technique lists the devices it is for. Drawn from the cards' text alone, blind to the eval cases (training/eval/step2/devices).
 */
export type TechniqueDevice =
  | 'knowledge_gap'
  | 'hidden_secret'
  | 'mystery'
  | 'reveal'
  | 'reversal'
  | 'plant'
  | 'payoff'
  | 'foretold'
  | 'deadline'
  | 'dilemma'
  | 'eerie_threat'
  | 'action'
  | 'held_moment'
  | 'past_told'
  | 'embedded'
  | 'time_skip'
  | 'revisit'
  | 'repetition'
  | 'unspoken'
  | 'verbal_clash'
  | 'misunderstanding'
  | 'overhear'
  | 'crowd_voice'
  | 'first_appearance'
  | 'realization'
  | 'confession'
  | 'delayed_outcome'
  | 'relationship_shift'
  | 'humor'
  | 'satire'
  | 'new_place'
  | 'world_rules'
  | 'simultaneous'
  | 'ordinary_life'
  | 'aftermath'
  | 'contrast'
  | 'loss'
  | 'meaningful_object'
  | 'differing_views'
  | 'threshold'
  | 'release'
/**
 * Fixed effect tags (§9): what a scene wants and what a technique gives.
 */
export type TechniqueEffect =
  | '긴장'
  | '서스펜스'
  | '호기심'
  | '놀람'
  | '반전'
  | '공포'
  | '불안'
  | '비애'
  | '연민'
  | '공감'
  | '카타르시스'
  | '해학'
  | '풍자'
  | '아이러니'
  | '여운'
  | '몰입'
  | '인물밀착'
  | '거리두기'
  | '속도감'
  | '감속'
  | '강조'
  | '통일감'
  | '완결감'
  | '순환감'
  | '운명감'
  | '모호성'
  | '신비감'
  | '경이'
  | '현실감'
  | '생동감'
  | '낯설게하기'
  | '주제부각'
  | '상징성'
  | '기대형성'
  | '기대배반'
  | '정보전달'
  | '존재감'
  | '비극성'
  | '설렘'
  | '해방감'
  | '답답함'
  | '혼란'
  | '메타인식'
  | '대비'
  | '리듬'
  | '성찰'
/**
 * Fixed situation tags (§9): what happens in a scene.
 */
export type TechniqueSituation =
  | '도입'
  | '인물등장'
  | '일상'
  | '사건발생'
  | '조사'
  | '단서제시'
  | '진실폭로'
  | '반전'
  | '갈등고조'
  | '전투'
  | '추격'
  | '위기'
  | '절정'
  | '좌절'
  | '죽음'
  | '이별'
  | '재회'
  | '로맨스'
  | '배신'
  | '과거사'
  | '성장'
  | '각성'
  | '복수'
  | '설전'
  | '시간경과'
  | '장소이동'
  | '세계관설명'
  | '코미디'
  | '공포'
  | '꿈환상'
  | '동시사건'
  | '결말'
  | '회차마무리'
  | '숨고르기'
  | '내적갈등'
  | '대규모사건'
  | '관계변화'
  | '비밀'
  | '징조'
  | '깨달음'
export type PlanSceneNumber = number
/**
 * `card` role output (§13). The server constrains and validates with the variant for the requested type. Evidence indexes are the 0-based [n] numbers of the server-split note sentences in the prompt. The server then drops out-of-range indexes, unknown field paths and unknown card ids, assigns ms_/fs_ ids, sets placement fields from context and restores pinned fields (§13).
 */
export type CardOutput =
  | WorldCardOutput
  | CharacterCardOutput
  | RegionCardOutput
  | MainStoryCardOutput
  | PartCardOutput
  | EpisodeCardOutput
/**
 * data of the SSE events of POST /drafts/{draftId}/messages; the SSE event name is the type. Order: reply*, then (unless the turn was the AI's opening) replied and source, or error at any point; always done last. The event name tells them apart (reply and replied share a shape), hence anyOf.
 */
export type DraftMessageEvent =
  DraftReplyEvent | DraftRepliedEvent | DraftSourceEvent | DraftErrorEvent | DraftDoneEvent
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
 * How a scene device figures in the scene (scene v5): main = it carries the scene's core (the recommendation uses these), sub = present but incidental, none = absent, merely possible or another scene's.
 */
export type DeviceRole = 'main' | 'sub' | 'none'
/**
 * Catalog field (§9): rhe 수사법·문체, str 구성·플롯 구조, tim 시간·속도, voi 시점·서술자·화법, inf 정보 조절·긴장·장르 효과, cha 인물·대화, des 묘사·공간·상징·상호텍스트, ser 도입·결말·연재·매체 차용.
 */
export type TechniqueCategory = 'rhe' | 'str' | 'tim' | 'voi' | 'inf' | 'cha' | 'des' | 'ser'
/**
 * The level a technique works at (§9); sentence-only cards are never direction candidates.
 */
export type TechniqueScope = '문장' | '장면' | '회차' | '아크' | '작품'
/**
 * Shown on the spine and cover; the server trims it.
 */
export type WorkTitle = string
/**
 * Spine and cloth cover colour, lowercase #rrggbb; null = the app's default, stable per work id.
 */
export type BookColor = string | null

/**
 * DELETE /cards/{cardId}: what went (the card, and a part's episodes with ?episodes=delete); POST /cards/{cardId}/restore brings all of it back until restore_until (§8).
 */
export interface CardDeleted {
  /**
   * @minItems 1
   */
  deleted: [CardId, ...CardId[]]
  /**
   * ISO 8601 UTC; about 10 s after the delete.
   */
  restore_until: string
}
/**
 * GET /works/{workId}/cards?type=&q=: the work's cards in creation order; q matches the start of any word of the name (best matches first).
 */
export interface CardList {
  cards: Card[]
}
export interface WorldCard {
  id: CardId
  work_id: WorkId
  type: 'world'
  name: CardName
  status: CardStatus
  source_notes: SourceNotes
  data: WorldData
  evidence: CardEvidence
  ai_guess: AiGuessFields
  pinned: PinnedFields
  schema_version: SchemaVersion
}
/**
 * World card data (§7, §15): one topic of the setting per card, e.g. a magic system, a faction, an era, terms.
 */
export interface WorldData {
  /**
   * rule 규칙·능력, faction 세력·조직, history 역사·사건, culture 문화·용어, other 기타.
   */
  category: ('rule' | 'faction' | 'history' | 'culture' | 'other') | null
  summary: string | null
  details: string | null
  /**
   * Evidence for the world-rule check (§10).
   */
  rules: WorldRule[]
  terms: WorldTerm[]
  /**
   * Character, region or world cards this topic involves (e.g. faction members, where a rule holds).
   */
  related: CardId[]
}
export interface WorldRule {
  rule: string
  exception: string | null
}
export interface WorldTerm {
  term: string
  meaning: string | null
}
/**
 * Field path (e.g. personality.traits) -> 0-based indexes of supporting source-note sentences (server split).
 */
export interface CardEvidence {
  [k: string]: number[] | undefined
}
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
  /**
   * Finite map units (no NaN or Infinity).
   */
  map_x: number
  /**
   * Finite map units (no NaN or Infinity).
   */
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
   * One entry per stage, in story order; the server sets each name by its position (§15: exactly the type's sequence).
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
   * One entry per stage, in story order; the server sets each name by its position (§15: exactly the type's sequence).
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
  /**
   * World cards this episode relies on (stage 2-3 context, world-rule check).
   */
  world: CardId[]
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
 * GET /cards/{cardId}/references: cards that point at this one, read from the relation tables (§6), for the delete confirmation and edit mode (§8).
 */
export interface CardReferences {
  references: CardReference[]
}
export interface CardReference {
  card_id: CardId
  type: 'world' | 'character' | 'region' | 'main_story' | 'part' | 'episode'
  name: string | null
  /**
   * Where the referencing card points at it, as a data path: relations, origin_region_id, parent_id, links, related, characters, locations.main, locations.others, world, links.prev, links.next, links.causes, part_id, fulfills, foreshadowing.payoffs.
   */
  field: string
}
/**
 * GET /works/{workId}/completeness: what the completeness panel shows (§7, §8 S1-3), from the relation tables.
 */
export interface Completeness {
  /**
   * Every milestone of the main story, in order, with the parts and episodes that fulfil it (each must be in exactly one part).
   */
  milestones: MilestoneFulfilment[]
  /**
   * Every planted foreshadowing; payoff_episode_id null = not paid off yet.
   */
  foreshadowing: ForeshadowingStatus[]
  /**
   * Cards with a §15 required field missing.
   */
  incomplete: IncompleteCard[]
}
export interface MilestoneFulfilment {
  id: MilestoneId
  order: number
  text: string
  parts: CardId[]
  episodes: CardId[]
}
export interface ForeshadowingStatus {
  id: ForeshadowingId
  text: string
  plant_episode_id: CardId
  payoff_episode_id: CardId | null
}
export interface IncompleteCard {
  card_id: CardId
  type: 'world' | 'character' | 'region' | 'main_story' | 'part' | 'episode'
  name: string | null
}
/**
 * GET /works/{workId}/region-links: the work's region_link rows (§14) for the region map: lines labelled with travel time, as long as the journey.
 */
export interface RegionLinks {
  links: RegionLinkRow[]
}
export interface RegionLinkRow {
  from_id: CardId
  to_id: CardId
  /**
   * null when the journey is unknown.
   */
  travel: RegionTravel | null
  /**
   * Where to_id lies from from_id, as written (e.g. 남).
   */
  direction: string | null
}
/**
 * GET /works/{workId}/relations?kind=: relation rows of the work (§6: references come from relation tables). world: world card -> related card (함께 보기, §8). character: character -> character with the relation (관계도). origin: character -> origin region (dex back). parent: region -> its parent region (map areas). episode_region: episode -> region, relation 'main' for locations.main (map badges). episode_part: episode -> its part, relation = its order within the part (story). episode_link: episode -> episode, relation 'order' (comes right before) or 'cause'. episode_character: episode -> character (timeline card back).
 */
export interface CardRelations {
  relations: CardRelation[]
}
export interface CardRelation {
  from_id: CardId
  to_id: CardId
  /**
   * The relation text (character), 'main' for an episode's main region; otherwise null.
   */
  relation: string | null
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
 * GET /episodes/{episodeId}/plans: the episode's plan, or none yet (one per episode).
 */
export interface PlanList {
  /**
   * @maxItems 1
   */
  plans: PlanRecord[]
}
/**
 * A stored direction plan (§14 direction_plan): one per episode.
 */
export interface PlanRecord {
  id: PlanId
  episode_id: CardId
  status: PlanStatus
  plan: DirectionPlan
}
/**
 * An episode's direction plan (§9): chapters in order, each chapter's scenes in narration order, each scene's beats in narration order. Confirmed when every scene is.
 */
export interface DirectionPlan {
  episode: CardId
  /**
   * @minItems 1
   * @maxItems 5
   */
  chapters: [PlanChapter, ...PlanChapter[]]
}
export interface PlanChapter {
  /**
   * 1..n within the episode; the chapter is cut after its last scene.
   */
  chapter: number
  /**
   * Characters incl. spaces; the chapter's scene targets sum to it.
   */
  target_chars: number
  /**
   * In narration order.
   *
   * @minItems 1
   */
  scenes: [PlanScene, ...PlanScene[]]
}
export interface PlanScene {
  /**
   * Story-order number from the `scene` role (1..n).
   */
  scene: number
  status: SceneStatus
  /**
   * The episode structure stage the scene comes from.
   */
  source: string
  summary: string
  /**
   * What the scene must give the reader, one sentence.
   */
  core: string
  /**
   * Characters incl. spaces; the scene's beat targets sum to it.
   */
  target_chars: number
  /**
   * The devices the scene role answered main (pre-checked for the user).
   */
  ai_devices: TechniqueDevice[]
  /**
   * The devices the scene role answered sub (first among the unchecked).
   */
  sub_devices: TechniqueDevice[]
  /**
   * The user's checked devices (ai_devices until corrected); the recommendation uses them.
   */
  devices: TechniqueDevice[]
  /**
   * @maxItems 3
   */
  effects: TechniqueEffect[]
  /**
   * @maxItems 3
   */
  situations: TechniqueSituation[]
  /**
   * The scene's recommended cards in rank order with what they share with it.
   *
   * @maxItems 5
   */
  recommended: PlanRecommendation[]
  /**
   * The user's cards for the scene (1-3 to direct it; empty before the pick).
   *
   * @maxItems 3
   */
  chosen: TechniqueId[]
  /**
   * What the scene reveals to the reader (from `arrange`), possibly nothing.
   */
  reveal: string[]
  /**
   * In narration order; empty until the scene is directed.
   */
  beats: PlanBeat[]
}
export interface PlanRecommendation {
  rank: number
  technique: TechniqueId
  devices: TechniqueDevice[]
  effects: TechniqueEffect[]
  situations: TechniqueSituation[]
}
export interface PlanBeat {
  /**
   * 1..n within the scene, set by the server.
   */
  order: number
  /**
   * What happens in the beat (the write role's instruction).
   */
  summary: string
  /**
   * The scene's chosen or serial cards this beat realizes.
   */
  techniques: TechniqueId[]
  /**
   * Point of view, e.g. 테오 1인칭, 3인칭 관찰.
   */
  pov: string
  mode: BeatMode
  focus: BeatFocus
  density: BeatDensity
  tension: number
  /**
   * Characters incl. spaces, set by the server from the model's proportions.
   */
  target_chars: number
}
/**
 * PATCH /plans/{planId}: the user's narration order and cuts (§9): chapters in order, each a list of story-order scene numbers in narration order, cut after its last. Every scene exactly once and 1-5 chapters, else 422 PLAN_LAYOUT_INVALID.
 */
export interface PlanUpdate {
  chapters: PlanSceneNumber[][]
}
/**
 * PUT /plans/{planId}/scenes/{scene}/beats: the user's beats for a directed scene in narration order (§9). The server numbers them 1..n and rescales target_chars (weights) to the scene's; techniques must be the scene's chosen or serial cards (422 BEATS_INVALID).
 */
export interface SceneBeatsUpdate {
  /**
   * @minItems 1
   */
  beats: [BeatEdit, ...BeatEdit[]]
}
export interface BeatEdit {
  summary: string
  techniques: TechniqueId[]
  pov: string
  mode: BeatMode
  focus: BeatFocus
  density: BeatDensity
  tension: number
  /**
   * A weight: the server rescales the beats' to sum to the scene's target.
   */
  target_chars: number
}
/**
 * PUT /plans/{planId}/scenes/{scene}/devices: the user's checked devices for the scene (§9); its recommendations are recomputed from them.
 */
export interface SceneDevicesUpdate {
  devices: TechniqueDevice[]
}
/**
 * POST /plans/{planId}/scenes/{scene}/pick: the cards to direct the scene with, in the user's order (§9). The count (1-3) beyond one and the cards themselves are checked by the server: TOO_MANY_TECHNIQUES, TECHNIQUE_NOT_CANDIDATE, TECHNIQUES_CONFLICT.
 */
export interface ScenePick {
  /**
   * @minItems 1
   */
  techniques: [TechniqueId, ...TechniqueId[]]
}
/**
 * POST /works/{workId}/drafts: open the card drawer (§8). card_id = edit that card (its notes load, the chat starts empty); null = a new card. 423 STAGE_LOCKED once planning is locked.
 */
export interface DraftCreate {
  type: 'world' | 'character' | 'region' | 'main_story' | 'part' | 'episode'
  card_id?: CardId | null
  /**
   * World book tab the new entry was started from: a hint for card generation, never asked in chat (§8).
   */
  category?: ('rule' | 'faction' | 'history' | 'culture' | 'other') | null
  /**
   * New episode: the part selected on the story screen; the episode is placed last in it.
   */
  part_id?: CardId | null
}
/**
 * POST /drafts/{draftId}/generate (카드 생성, a job): pinned replaces the draft's pinned fields, kept from the last generated or saved card (§8); structure = the 4/5 stages the user picked for a part or an episode.
 */
export interface DraftGenerate {
  /**
   * @maxItems 50
   */
  pinned?: string[]
  structure?: (4 | 5) | null
}
/**
 * POST /drafts/{draftId}/messages: one chat turn (§8). Empty text on a draft without turns lets the AI open with a question. The reply streams as SSE (DraftMessageEvent).
 */
export interface DraftMessage {
  text: string
  /**
   * Cards the user @-mentioned in this turn; they stay in the draft's context.
   *
   * @maxItems 20
   */
  refs?: CardId[]
}
/**
 * PUT /drafts/{draftId}/source: the user edited the source notes directly (§8).
 */
export interface DraftSource {
  notes: string
}
/**
 * PUT /drafts/{draftId}/structure: the user picked another stage count for the generated part or episode (§7). 4 = its 5-stage structure mapped onto 기승전결 in code (기=발단, 승=전개+위기, 전=절정, 결=결말), nothing else of the card changes. 5 (the AI's split of 승) is not built yet.
 */
export interface DraftStructure {
  type: 4
}
/**
 * A card being made or edited in the drawer (§8). Lives in server memory only and is gone on DELETE, save or restart: conversations and unsaved drafts are never stored (§6).
 */
export interface Draft {
  id: DraftId
  work_id: WorkId
  type: 'world' | 'character' | 'region' | 'main_story' | 'part' | 'episode'
  /**
   * The card being edited; null for a new card.
   */
  card_id: CardId | null
  category: ('rule' | 'faction' | 'history' | 'culture' | 'other') | null
  part_id: CardId | null
  /**
   * Source notes as the user and the source role left them.
   */
  notes: string
  /**
   * notes split by the server (§15); evidence, highlights and changed sentences use these 0-based indexes.
   */
  sentences: string[]
  /**
   * The conversation so far (memory only).
   */
  turns: DraftTurn[]
  /**
   * Field paths kept from the saved card when the card is generated again.
   */
  pinned: string[]
  /**
   * The last generated card, not saved yet; null before 카드 생성.
   */
  generated: CardOutput | null
}
export interface DraftTurn {
  role: 'user' | 'ai'
  text: string
}
export interface WorldCardOutput {
  type: 'world'
  name: CardName
  data: WorldData
  evidence: CardEvidence
  ai_guess: AiGuessFields
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
 * event: reply. The next piece of the AI's answer.
 */
export interface DraftReplyEvent {
  text: string
}
/**
 * event: replied. The answer is complete (its whole text); the notes update starts.
 */
export interface DraftRepliedEvent {
  text: string
}
/**
 * event: source. The notes after this turn: changed = indexes of new or rewritten sentences (highlighted), questions for missing information, similar names to confirm as one entity (§8).
 */
export interface DraftSourceEvent {
  notes: string
  sentences: string[]
  changed: number[]
  /**
   * @maxItems 3
   */
  questions: string[]
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
 * event: error. The reply or the notes update failed; code maps to a UI state (LLM_* codes, NOTES_CHANGED when the user edited the notes meanwhile).
 */
export interface DraftErrorEvent {
  code: string
  message: string
}
/**
 * event: done. Last event.
 */
export interface DraftDoneEvent {}
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
/**
 * `arrange` role output (§9, §13): the episode's scenes in chapters, each chapter's scenes in narration order (a scene moved earlier or later = flashback, in medias res), cuts between chapters only. The server requires every scene exactly once and rescales each chapter's target_chars to sum to the chapter's target, keeping the model's proportions.
 */
export interface ArrangeOutput {
  /**
   * @minItems 1
   * @maxItems 5
   */
  chapters: [ArrangeChapter, ...ArrangeChapter[]]
}
export interface ArrangeChapter {
  /**
   * In narration order; the chapter is cut after its last scene, on a hook.
   *
   * @minItems 1
   */
  scenes: [ArrangeScene, ...ArrangeScene[]]
}
export interface ArrangeScene {
  /**
   * The scene's story-order number (narrowed per call to 1..n).
   */
  scene: number
  /**
   * The scene's share of its chapter in characters (a proportion: the server rescales).
   */
  target_chars: number
  /**
   * What the scene reveals to the reader, possibly nothing.
   */
  reveal: string[]
}
/**
 * `direct` role output (§9, §13): one scene's beats in narration order. The server numbers them 1..n and rescales their target_chars to sum to the scene's, keeping the model's proportions.
 */
export interface DirectOutput {
  /**
   * @minItems 1
   */
  beats: [DirectBeat, ...DirectBeat[]]
}
export interface DirectBeat {
  /**
   * What happens in the beat, one or two sentences.
   */
  summary: string
  /**
   * Cards the beat realizes, among the scene's chosen and serial cards (narrowed per call).
   */
  techniques: TechniqueId[]
  pov: string
  mode: BeatMode
  focus: BeatFocus
  density: BeatDensity
  tension: number
  /**
   * The beat's share of the scene in characters (a proportion: the server rescales).
   */
  target_chars: number
}
/**
 * `scene` role output (§9, §13): the episode split into scenes in story order. The server drops scenes whose source is not one of the episode's structure stage names, renumbers the rest 1..n and drops repeated tags.
 */
export interface SceneOutput {
  /**
   * @minItems 1
   */
  scenes: [OutputScene, ...OutputScene[]]
}
export interface OutputScene {
  scene: number
  /**
   * The episode structure stage the scene comes from (§9 `source` = episode.stage).
   */
  source: string
  /**
   * What happens, in one or two sentences.
   */
  summary: string
  /**
   * Why the scene is in the episode, in one sentence: what it must give the reader (scene v5); written before the devices, which are answered against it.
   */
  core: string
  devices: SceneDevices
  /**
   * Effects the scene wants the reader to feel.
   *
   * @minItems 1
   * @maxItems 3
   */
  effects: [TechniqueEffect, ...TechniqueEffect[]]
  /**
   * Situations the scene is in.
   *
   * @minItems 1
   * @maxItems 3
   */
  situations: [TechniqueSituation, ...TechniqueSituation[]]
}
/**
 * An answer per scene device (technique-device.json, same keys in the same order), main, sub or none, after the core and before the tags; code recommends the cards sharing the main devices (§9).
 */
export interface SceneDevices {
  knowledge_gap: DeviceRole
  hidden_secret: DeviceRole
  mystery: DeviceRole
  reveal: DeviceRole
  reversal: DeviceRole
  plant: DeviceRole
  payoff: DeviceRole
  foretold: DeviceRole
  deadline: DeviceRole
  dilemma: DeviceRole
  eerie_threat: DeviceRole
  action: DeviceRole
  held_moment: DeviceRole
  past_told: DeviceRole
  embedded: DeviceRole
  time_skip: DeviceRole
  revisit: DeviceRole
  repetition: DeviceRole
  unspoken: DeviceRole
  verbal_clash: DeviceRole
  misunderstanding: DeviceRole
  overhear: DeviceRole
  crowd_voice: DeviceRole
  first_appearance: DeviceRole
  realization: DeviceRole
  confession: DeviceRole
  delayed_outcome: DeviceRole
  relationship_shift: DeviceRole
  humor: DeviceRole
  satire: DeviceRole
  new_place: DeviceRole
  world_rules: DeviceRole
  simultaneous: DeviceRole
  ordinary_life: DeviceRole
  aftermath: DeviceRole
  contrast: DeviceRole
  loss: DeviceRole
  meaningful_object: DeviceRole
  differing_views: DeviceRole
  threshold: DeviceRole
  release: DeviceRole
}
/**
 * `source` role output (§13). The model sees the notes as [n]-numbered sentences (server split, §15) and returns only edits; the server applies them, so sentences it does not name stay byte-identical. Changed sentences are the edited and added ones.
 */
export interface SourceOutput {
  /**
   * Existing sentences this turn changes: text replaces sentence [index], null deletes it. The server drops out-of-range and repeated indexes.
   */
  edits: SourceEdit[]
  /**
   * New sentences appended after the notes, in order.
   */
  added: string[]
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
export interface SourceEdit {
  index: number
  text: string | null
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
 * GET /techniques?q=: every technique in id order; q keeps those whose name, English name or an alias contains it.
 */
export interface TechniqueList {
  techniques: TechniqueSummary[]
}
/**
 * A technique in a list (GET /techniques).
 */
export interface TechniqueSummary {
  id: TechniqueId
  category: TechniqueCategory
  name: string
  name_en: string
  scope: TechniqueScope[]
  effects: TechniqueEffect[]
  situations: TechniqueSituation[]
  description: string
}
/**
 * A direction technique card (§9), shared across works; from the user's catalog. example is shown to the user only, never put in a prompt.
 */
export interface Technique {
  id: TechniqueId
  category: TechniqueCategory
  name: string
  name_en: string
  aliases: string[]
  /**
   * @minItems 1
   */
  scope: [TechniqueScope, ...TechniqueScope[]]
  /**
   * @minItems 1
   */
  effects: [TechniqueEffect, ...TechniqueEffect[]]
  /**
   * @minItems 1
   */
  situations: [TechniqueSituation, ...TechniqueSituation[]]
  /**
   * Scene devices the technique is for (§9), 0-4; [] for a card with no scene device (style, narration mode).
   *
   * @maxItems 4
   */
  devices: TechniqueDevice[]
  /**
   * Definition.
   */
  description: string
  /**
   * What the reader feels and why.
   */
  effect_detail: string
  /**
   * @minItems 1
   */
  use_when: [string, ...string[]]
  /**
   * Cautions.
   *
   * @minItems 1
   */
  avoid_when: [string, ...string[]]
  /**
   * What the story must already hold for the technique to work.
   */
  requires: string
  /**
   * How to apply it to the chronological story (direct).
   */
  mechanism: string
  /**
   * One instruction line for a beat that realizes it (write).
   */
  prompt_hint: string
  /**
   * A short sample: UI only.
   */
  example: string
  /**
   * @minItems 1
   */
  sources: [TechniqueSource, ...TechniqueSource[]]
  /**
   * Techniques that combine well.
   */
  pairs_with: TechniqueId[]
  /**
   * Techniques it cannot share a scene with; a pair conflicts if either card lists the other.
   */
  conflicts_with: TechniqueId[]
}
export interface TechniqueSource {
  /**
   * Empty for a general term.
   */
  author: string
  title: string
  year: number | null
  note: string
}
/**
 * GET /works/{workId}/covers: the book's uploaded covers, oldest first.
 */
export interface CoverList {
  covers: Cover[]
}
/**
 * A cover illustration uploaded for one book (§12 책 꾸미기): WebP, portrait 1:1.5, cropped by the app. GET /works/{workId}/covers/{coverId}/image serves the file.
 */
export interface Cover {
  id: CoverId
  work_id: WorkId
  /**
   * ISO 8601 UTC.
   */
  created_at: string
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
 * A book in the library (§12 S0, §14 work).
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
  color: BookColor
  /**
   * Cover illustration on the front; null = cloth cover in the book colour.
   */
  cover_id: CoverId | null
  /**
   * ISO 8601 UTC.
   */
  updated_at: string
}
/**
 * PATCH /works/{workId}: 제목 바꾸기 and 책 꾸미기 (§12 S0). Only the keys sent change (none sent → 422 VALIDATION_ERROR); the book keeps its place on the shelf (updated_at kept).
 */
export interface WorkUpdate {
  /**
   * Raw input, checked like POST /works: whitespace collapsed, then 1..100 chars (TITLE_EMPTY, TITLE_TOO_LONG).
   */
  title?: string
  color?: BookColor
  /**
   * One of this book's covers (404 COVER_NOT_FOUND otherwise); null = cloth cover in the book colour.
   */
  cover_id?: CoverId | null
}
