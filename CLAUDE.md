# Aiplot

Sole spec for this repo. If code and this file disagree, ask the user. Section refs: §n.

## 1 Overview
Local Windows desktop app (NVIDIA 8GB VRAM) for writing Korean web novels. All models/data local. AI proposes, user decides.
- Stage 1 Planning: user chats with LLM → LLM tidies chat into source notes → cards generated from notes → user saves. Cards: character, region, main_story, part, episode.
- Stage 2 Direction: per episode, AI splits into scenes, recommends 1–3 technique cards/scene (1 → auto-picked, 2–3 → user picks), builds plan (chapter → scene → beat). User confirms per episode.
- Stage 3 Writing: LLM writes beat by beat (500–1000 chars, 6–10 beats/chapter, ~5500 chars/chapter incl. spaces), tracks state, checks consistency.
- Starting a stage locks earlier stages (read-only).

## 2 Stack
Electron + React + TS (Vite via electron-vite); Zustand (UI state) + TanStack Query (server state); TipTap (manuscript); React Flow + d3-force (timeline/map/curves). Python 3.12 FastAPI local server; HTTP + SSE on 127.0.0.1. SQLite + FTS5 (names); stdlib sqlite3, no ORM; migrations `db/migrations/NNN_name.sql` tracked by `PRAGMA user_version`; NNN unique + contiguous (CI test); merged migrations never change; renumber unmerged ones on rebase, then rebuild dev DBs. Codegen: json-schema-to-typescript (TS), datamodel-code-generator (Pydantic, via `uv run --project ../server`). llama.cpp server Windows CUDA build, pinned b11982 + CUDA 13.4 x64 (needs NVIDIA driver supporting CUDA 13): `llama-b11982-bin-win-cuda-13.4-x64.zip` (164987252 bytes, sha256 `aebd94feb10c3f13a770e8f78a0c75d21c4e2701c1f7823e866613f1aa2f82ab`), `cudart-llama-bin-win-cuda-13.4-x64.zip` (423535356 bytes, sha256 `738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668`); downloaded at first run, not in installer; LoRA hot-swap via `/lora`. Base: Qwen3-8B uncensored (braindao Qwen3-8B-Uncensored), LoRAs F16; GGUF pins (HF repo + rev, file, bytes, sha256) live in `server/config/profiles/`: Q4_K_M (default) and candidate i1-Q5_K_M, Korean writing quality blind-compared in unit 5, winner becomes base; training weights = `braindao/Qwen3-8B-Uncensored` (renamed from `braindao/Qwen3-8B-Uncensor-v2`, the GGUF's source; HF redirects) rev `f3cfe07e5e9581bad4f92f89d7a68c901acc1c33` (HEAD, unchanged since 2025-05-13; GGUF quantized 2025-05-14; 4 safetensors shards, bf16; verify against the repo's f16 GGUF before training). Upstream card empty (method unknown), no license (Qwen3-8B is Apache-2.0): confirm before release (base download and LoRAs). Korean writing fitness, refusals, regressions vs stock Qwen3-8B, embedded chat template/thinking toggle checked in unit 5. Optional images: ComfyUI portable + SDXL semi-realistic, fixed workflow JSON. Packaging: PyInstaller + electron-builder. Tests: Vitest, pytest, Playwright (Electron). Lint: ESLint+Prettier+tsc; Ruff+mypy. npm (app, schemas), uv (server, training). Node 22, Python 3.12. CI: GitHub Actions (Windows runner builds installer).

## 3 Layout
```
app/electron/{main.ts (server lifecycle, OS dialogs, snapshots), preload.ts (port+token), processes.ts (health, restart ≤3)}
app/src/{screens,components,api (REST+SSE),stores,strings (Korean UI text),types (GENERATED)}
app/tests/ (+ e2e/)
server/aiplot/{main.py,api/ (thin routers),services/,llm/ (router, profiles, LoRA registry, llama/comfy/fake clients),jobs/,db/ (+migrations/),generated/ (GENERATED)}
server/{prompts/{role}/v{n}.md, config/{roles.yaml,profiles/*.yaml}, data/techniques/, data/style/{id}-v{n}.md (style framework), workflows/, tests/ (+fixtures/)}
schemas/ (JSON Schema source of truth) + codegen/
training/{seeds,generate,filter,notebooks,eval} — not shipped
```
Runtime data: `%LOCALAPPDATA%\Aiplot\{data\aiplot.db, images, snapshots, models, lora, llama, comfyui, logs, electron (Chromium profile)}`.

## 4 Commands
Keep exact names accurate. Not yet: pyinstaller spec + installer build (unit 14). Node version: `.node-version`.
```
cd schemas && npm i && npm run codegen        # → app/src/types, server/aiplot/generated
npm test                                      # (schemas) validate JSON Schemas; CI fails on stale generated files
cd server && uv sync
uv run python -m aiplot.main --dev            # port 8765, token AIPLOT_TOKEN
uv run pytest | uv run ruff check . && uv run ruff format --check . | uv run mypy aiplot tests
uv run pyinstaller aiplot-server.spec
cd app && npm i
npm run dev | test | lint | typecheck | e2e | build
```
Env: `AIPLOT_DATA_DIR` (override data dir), `AIPLOT_PORT`/`AIPLOT_TOKEN`, `AIPLOT_FAKE_LLM=1` (fixture LLM, no GPU; default in tests/CI).
Before finishing: lint + typecheck + tests for touched packages.

## 5 Conventions
- English code/comments/commits; Korean user-facing text in `app/src/strings/`.
- Conventional Commits; scopes app|server|schemas|training|ci|docs. Small changes (one screen/endpoint group/service).
- Names: React PascalCase files; TS camelCase; Python snake_case; DB snake_case singular tables; API plural nouns, camelCase path params; JSON fields snake_case except job/SSE payload keys in §16; error codes UPPER_SNAKE; ID prefixes: w_ work, c_ card, tech_ technique, pl_ plan, ch_ chapter, b_ beat, wr_ warning, job_ job, ms_ milestone, fs_ foreshadowing, wl_ worldline.
- TS: strict, no `any`; server types only from generated; server data only in TanStack Query.
- Python: full type hints, mypy clean, Pydantic I/O; routers thin → services → db (SQL only in db/); multi-table writes in one transaction; work >10s runs as a job with SSE; LLM calls only via router by role.
- Format changes: edit `schemas/` → codegen → commit generated. Card field change → bump `schema_version` + migration + backup import conversion.
- Prompts: files only; never edit old version, add v{n+1}, update roles.yaml; store prompt version with every output; context blocks tagged `<원문> <참고 카드> <상태> <지시>`; JSON roles pass schema as llama.cpp `json_schema`.
- DB changes only via migrations.
- UI: one accent color per screen; irreversible = red, never default, strong ones require typing work title; warnings orange; never color-only meaning; motion only on state change 0.2–0.3s (respect reduced motion); waits >10s show progress, ETA, background option; themes light/dark/system; manuscript 17px, line-height 1.7.

## 6 Prohibitions
- Never edit card fields directly; change source notes and regenerate. Exceptions: region `map_x/map_y`; timeline node drag (LLM writes one line into notes, user confirms).
- Never persist conversations (memory only, discard on drawer close) or unsaved drafts.
- Never modify locked-stage data: server returns 423 STAGE_LOCKED. Never reopen a stage without snapshot.
- Never hand-edit generated files. Never query references from card `data`; use relation tables.
- Never trust LLM char counts; count in code incl. spaces.
- No runtime network use of user data, no telemetry; external LLM APIs only in training/.
- No embeddings/vector search/sqlite-vec. No model files in repo/installer. No torch/transformers in server. No Ollama. No macOS/Linux code. No automatic user backups. No app data outside data dir (except user-chosen export/backup paths). No real models in unit tests. No training/eval data in training/generate. No other authors' novels as training data. No work beyond current dev step (§20) unless asked.

## 7 Domain
- character: theme; personality{traits, behaviors[{situation,action}]} (check evidence); speech{description, examples 3–5} (writing quality); appearance (initial); relations; origin_region.
- region: parent; links[{target, travel{value,unit,mode}, direction?}] (travel = evidence for impossible-movement check); appearance; environment{natural,social}; sensory{smell,sound,mood}.
- main_story: theme, premise, ending, milestones. Creation order main → parts → episodes.
- part: order, title, theme, fulfills[milestone], start, end, structure?. All milestones must be assigned to exactly one part before episodes. Deleting/merging part with episodes: ask move or delete.
- episode: part, order (within part), theme, relation_to_main, fulfills, characters, locations{main,others}, links{prev,next,causes}, foreshadowing{plants,payoffs}, worldline, structure{type 4|5, stages[{name,summary,tension 1–5}]}, synopsis, summary (stage 3).
- Structure: 5-stage 발단·전개·위기·절정·결말 (conflict bursts); 4-stage 기승전결 (situation flips). AI recommends with reason, user picks. Map 기=발단, 승=전개+위기, 전=절정, 결=결말; 5→4 auto, 4→5 AI proposes split of 승, user confirms.
- Worldline: branch_episode_id; pre-branch episodes in all worldlines; hide tabs if one.
- Completeness: milestone fulfillment, unresolved foreshadowing, incomplete cards (missing required fields, incl. empty structure stages).
- State keys (fixed): location{region_id}; injury{part,severity,since_chapter,healed?}; item{name,action gain|lose}; knows_secret{secret,since_chapter}; relation_change{target_id,change}; appearance_change{text}. Appended per beat; context uses latest per card+key.

## 8 Stage 1 UI
Card drawer (all types): ~70% width, background dimmed; left chat (top) + source notes (bottom), right card preview; X/Esc closes. Opened by dex "+", card "원문 수정", "+ 새 에피소드", "+ 새 지역", main/part setup.
- Header: type, new/edit, name; episode shows part+region; part shows milestones.
- `chat` replies and asks for missing info; new cards may open with question/draft; parts open with LLM draft. After each reply `source` rewrites notes (reversals resolved, changed sentences briefly highlighted). User may edit notes.
- Model context: last few turns + notes + `@` cards.
- "카드 생성" → draft → "저장" writes notes+card+relations in one transaction. Unsaved close asks to save.
- Edit mode: load notes, new chat; regeneration shows only changed fields with old values struck; list cards referencing changed name/relations/characters before save.
- Pinned fields survive regeneration. `@이름` autocomplete. Generation inputs: notes + `@` cards + prior-stage cards (episode: main, part, regions).
- Click field → highlight evidence sentences; no evidence → "AI 추정". Empty required → "아직 정해지지 않음" + follow-up question. Similar names (레오/래오) → ask same entity.
- Type section: character speech preview; episode 4/5 picker with recommendation; part milestone assignment.
- After save: close, highlight card 0.3s. Locked: add/edit disabled, drawer won't open.

Dex (S1-1): grid + translucent "+" card. Front image+name (fallback first-letter image). Back (flip 0.3s): all fields; bottom row "원문 수정" left, red "삭제" right. Delete: confirm listing referencing cards, DELETE runs immediately (card + all relation rows touching it, one transaction; episode reconnect via `?reconnect=true`; part with episodes via `?episodes=move:{partId}|delete`); server keeps every row the delete removed or changed (relations, reconnected links, moved episodes' part/order, card_image rows; files removed after window) in memory ~10s; "되돌리기" toast → POST /cards/{cardId}/restore reverts all of it (re-indexes FTS5; skips relation rows whose other end is gone). Locked: read-only; image generation still allowed. Images (step 10): `image_prompt` → ComfyUI 2–4 candidates 896×1152, web-novel-cover semi-realistic, realistic proportions → user picks; store prompt+seed.

Region map (S1-2): node per region; lines labeled travel time; parents as dashed areas (double-click zoom). d3-force layout, length ~ travel time, respect direction. Drag changes map_x/y only (disabled when locked). Click flips (appearance, environment, mood, adjacent; same bottom row). Badge = episode count, hover lists. New node placed next to linked region. Wheel zoom, drag pan.

Story (S1-3): steps main → parts → episodes, each unlocks next. Timeline: Y region lanes, X story order (same column = simultaneous), X split by part with titles, main line on top, milestones above parts, node color = milestone. Node = episode, arrows = order/cause. Multi-region: main lane + small markers. Click flips (theme, milestones, stages, characters, foreshadowing, synopsis; delete asks to reconnect prev/next). "+ 새 에피소드" adds to selected part, auto-placed. Drag within part → notes line → confirm. Worldline tabs. Completeness panel + "연출 구성 시작" (lock warning; step 3). X axis = top row of S2 dual timeline.

## 9 Stage 2
Flow: select episode → `pick` (input: episode + technique list titles/one-liners) → scenes + 1–3 picks with rank, reason → auto-pick if 1, else user (keys 1–3, Enter = top) → `direct` (chosen cards' definition/effect/caution) → plan → user edits → confirm. All confirmed → "집필 시작" (lock warning).
Plan decides narration order (flashback, in medias res, reveal timing), chapter split (1–5/episode, cut on hooks), per beat pov, mode 장면화|요약, tension, target_chars.
```json
{"episode":"episode_007","chapters":[{"chapter":1,"target_chars":5500,"cut_after":"episode_007.위기",
"scenes":[{"scene":1,"source":"episode_007.위기",
"picks":[{"technique":"tech_04","name":"인 메디아스 레스","rank":1,"reason":"..."},{"technique":"tech_09","name":"시간 순 전개","rank":2,"reason":"..."}],
"chosen":"tech_04","reveal":["..."],
"beats":[{"order":1,"pov":"테오 1인칭","mode":"장면화","tension":4,"target_chars":800}]}]}]}
```
`source` = episode.stage; beat order = narration order; `reveal` optional.
Technique card: id, name, definition, effect, caution, source; ≥30 in `server/data/techniques/`, shared across works.
S2 screen: left episodes; center dual timeline (top story order, bottom narration, same event linked, reordered in accent) + tension curve with dashed chapter cuts; right technique picker + evidence. Top pick: glowing border + "✦ 추천" + reason (thick border if reduced motion). Changing a scene's card re-plans its beats. Beat drag → recheck changed part only. Cut drag → update chars/chapter. Beat select → technique, card, reason; "좋음/별로"+note stored as training feedback. "기획 보기" opens stage 1 read-only.

## 10 Stage 3
Beat loop: build context → `write` (stream by sentence) → count chars → `check` (state + warnings) → `summary` (progress) → adjust next target from remaining.
Write context (~5600/8k tokens, measure in step 1): instructions + style framework ~1000 (style v1 every-beat part measured 633 tokens, examples +105, Qwen3 tokenizer; role, summary, rules, dialogue, format and plain banned phrases every beat; examples and by_mode/by_pov/by_tension matching the beat (by_pov heading = substring of beat pov, e.g. 1인칭); empty sections omitted; its format rules override the basic format below; banned phrase or /regex/ (no multiline: ^ = beat start; regex only checked, never shown) in a beat → regenerate that beat up to 3×, then keep last + warning; style id+version stored with output); beat instruction ~300; summaries ≤2000 chars ~1500; previous ~1000 chars ~800; appearing characters + speech examples ~1000; latest state ~200; output ~800. Order: instructions + every-beat style sections first, byte-identical across beats (no per-call values) so llama.cpp prompt cache reuses them → beat-matched style sections → rest.
Summaries: chapter.progress_summary 300–500 (after each beat; covers current chapter before last 1000 chars); summary_long ~1000 (chapter end; previous chapter only); summary_short ~200 (chapter end; earlier chapters of episode); episode.summary ~300 (episode end; recent episodes). Cap 2000 chars, drop oldest episode summaries first. Edit or regenerate → redo chapter summaries + state.
Checks: out-of-character actions, appearance mismatch, impossible travel, state contradictions. Warning: kind, sentence position, evidence card, reason. Group same type; ignore reasons feed later checks; sensitivity setting.
Format: short paragraphs, frequent breaks, dialogue own line; end at cut_after with hook. Length 5500 ±10%.
S3-1 screen: left chapters (done/generating/waiting), center TipTap manuscript, right warnings + versions. "비트 3/8 · 예상 남은 시간" + bar. Server buffers tokens, emits `sentence` at . ? ! newline. Unchecked beats dim until `beat_checked`; warnings underlined + margin mark. Always-visible pause/stop/regenerate beat. Warning: "수정 제안" regenerates beat, "무시" records reason. Edits create versions (compare/restore). Counter vs 5500. Background run; completion summary (elapsed, chars, warnings). Confirmation unit setting: beat | chapter (default) | episode.

## 11 Lock, export, backup
- Lock: stage 2 locks 1; stage 3 locks 1–2; read-only view. Incomplete cards never block advance (warning lists them + complete cards referencing them); after advance they are inactive (so are episodes whose part or main_story is inactive): shown dimmed, excluded from stage 2–3 inputs/context/checks, references to them ignored (rows kept); "all confirmed" = ≥1 active episode and all active episodes confirmed. Reopen: snapshot → delete direction_plan and all below (picks, chapters, beats, versions, states, warnings); cards kept. Warn on advance and reopen with concrete counts (e.g. "기획 단계를 다시 열면 연출 계획서와 집필한 원고 12화가 삭제돼요. 이 작업은 되돌릴 수 없어요."); red non-default button; manuscript exists → type title.
- Export (any stage): pick finished chapters (+ select all; generating disabled), show count+chars. Formats: platform copy (normalized breaks; multi-chapter "다음 화 복사"), txt, docx, hwp (write .hwpx; .hwp only via installed Hangul automation). Remember last format. Files merged (chapter titles) or one per chapter via OS dialog.
- Backup (user-initiated only): `{title}_{YYYY-MM-DD}.aiplot` zip of work data, images, app/data version; no models. Show path+size. Import from library new-book → "백업 파일에서 가져오기"; never overwrite, add "{title} (가져옴)"; newer data version → ask app update; older → migrate.

## 12 Screens
S0 Library: books on shelf, recent first + highlight; translucent "+" book last ("새로 만들기" title only → contents, or import). Cover: title, stage, chapters. Hover: main theme, modified, chapters. Right-click "제목 바꾸기/백업 생성/삭제" (delete shows counts, type title). Progress band while generating. Empty: "첫 작품을 시작해 보세요".
S0-1 First run: capabilities/limits, download llama.cpp + base (~5GB, resumable, hash) or set path.
S1 Contents: opened book. Left: title, main theme, stage, card count, modified, "원고 내보내기", "백업 생성", "이어서 작업". Right: items by stage (캐릭터, 지역, 스토리 | 연출 | 집필, 소설 읽기) with dotted leader + status; last item highlighted; future dim (click explains); past locked read-only + "다시 열기". Top-bar title → contents; "← 서재".
S1-1/2/3 §8; S2 §9; S3-1 §10.
S3-2 Chapter list: read chapters bold, sort newest/oldest (remembered), toggle read, "이어 읽기". S3-3 Reader: read-only, prev/next, font size, line height; end of chapter marks read.
G Settings: automation level, models (list/path/size/redownload/delete; mismatched LoRA shown not loaded), theme, fonts, check sensitivity, shortcuts.
Common: top bar (title | stage indicator | settings), Ctrl+K quick open, 3 columns for S2/S3-1 collapsing to 2.
States: empty library; empty cards → LLM asks first; <10s → spinner in button, inputs usable; ≥10s → progress, step, ETA, background; done → summary modal user closes; locked; model error (missing/OOM) → plain cause + "다시 시도"; interrupted → saved to last beat, offer "이어서 생성".
Shortcuts: Ctrl+K; Ctrl+Enter generate card; Ctrl+S save card; Ctrl+. pause/resume; Ctrl+Shift+R regenerate beat; Ctrl+Z; ←/→ reader; 1–3/Enter S2; Esc close.
Components: BookShelf, BookItem, ContentsPage, ExportDialog, BackupDialog, StageLockDialog, CardCreatePanel, SourceEditor, GeneratedCard, NameCheckNotice, CharacterDex, FlipCard, ImageGenerator, RegionMap, EpisodeTimeline, StructurePicker, CompletenessPanel, TechniqueCardPicker, DualTimeline, TensionChart, EvidencePanel, GenerationProgress, ManuscriptEditor, ConsistencyWarning, VersionHistory, ChapterList, Reader, CompletionSummary.

## 13 Architecture
Electron main picks port+token → starts server → server reports ready (llama.cpp not required; /health reports llama/model missing → S0-1) → server starts llama.cpp whenever binary + model become available (boot, download done, path set), health-checks, /health reports model ready. Missing files ≠ crash (no restart count). Unresponsive child: restart ≤3 then error screen. Image job: unload llama model → ComfyUI → free → reload. Quit: save at beat granularity, stop children. Job queue: >10s tasks, survives screen changes, batches same role.
Router: `config/roles.yaml` role → profile, LoRA?, prompt version, sampling, thinking. `config/profiles/*.yaml`: GGUF path, chat template, thinking toggle, sampling, ctx 8192, KV type, `lora_mode hotswap|merged`; llama-server `-np 1 --cache-ram 1024` (host-RAM prompt cache keeps prefixes across roles), no `--cache-reuse`. LoRA registry: `lora/{id}.json` manifest (`schemas/lora/`) beside each adapter, with base GGUF sha256; never load mismatch. merged = per-role pre-merged GGUF + batch by role. Base swap must need config + LoRA only. `AIPLOT_FAKE_LLM=1` → fixture client.
Roles (thinking, model):
- chat: turns, notes, @cards → streamed short text, first char ≤2s (off, base)
- source: reply, notes → JSON new notes, questions ≤3, similar-name pairs (card_id or null; unknown ids and self-pairs dropped); changed sentences computed by server diff; empty notes replacing non-empty ones rejected (on, base)
- card: [0]-based numbered note sentences, refs, pinned → JSON type + name + data + evidence (sentence indexes) + ai_guess, constrained by the requested type's variant. Server then drops out-of-range indexes, unknown paths and unknown card ids; assigns ms_/fs_ ids (keeps ids of items whose text is unchanged); sets placement (episode part_id/order/links.prev,next/worldline_id, part order) from context; restores pinned (on, base)
- pick: episode, scenes, technique list → JSON 1–3 picks/scene (on, base + direction LoRA when ready)
- direct: episode, cards, chosen techniques → JSON plan (on, base + direction LoRA; baseline base)
- write: §10 context → text streamed by sentence (off, higher temp; base + style framework chosen in roles.yaml, later web novel LoRA)
- check: beat, cards, state → JSON state changes + warnings (on, base)
- summary: beat/chapter/episode text → text (off, base)
- image_prompt: appearance, personality → JSON EN positive/negative (off, base)
JSON roles low temp.

## 14 DB
`data/aiplot.db`: WAL, foreign_keys on, autocommit + explicit `transaction()`, one connection per request; migrations run at server start, each file + user_version bump in one transaction (no BEGIN/COMMIT in files), foreign keys off during migrations and `foreign_key_check` before each commit; DB newer than app → server exits.
- work(id,title,stage,locked_stage,last_item,updated_at)
- card(id,work_id,type,name,source_notes,data,evidence,ai_guess,pinned_fields,status,schema_version) — JSON cols
- character(card_id,theme,personality,speech,appearance_init,origin_region_id); region(card_id,parent_region_id,environment,sensory,map_x,map_y); main_story(card_id,theme,premise,ending); part(card_id,main_id,order,start,end); episode(card_id,part_id,order,structure,worldline_id,summary)
- milestone(id,main_id,order,text); region_link(from_id,to_id,travel_time,direction); char_relation(from_id,to_id,relation); episode_character/episode_region(episode_id,card_id); episode_link(from_id,to_id,kind order|cause); milestone_fill(milestone_id,card_id); foreshadowing(id,plant_episode_id,payoff_episode_id,text); worldline(id,work_id,name,branch_episode_id); card_image(id,card_id,path,prompt,seed)
- technique_card(id,name,definition,effect,caution,source) shared
- direction_plan(id,episode_id,status,plan JSON); technique_pick(id,plan_id,scene,technique_id,rank,reason,chosen)
- chapter(id,plan_id,work_id,number,target_chars,read,progress_summary,summary_long,summary_short); beat(id,chapter_id,order,source_stage,technique_id,pov,mode,tension,feedback); beat_version(id,beat_id,version,text,chars,origin generated|edited,prompt_version,style_id,style_version,created_at) latest = current
- state_record(id,beat_id,card_id,key,value); warning(id,version_id,card_id,kind,status,reason); snapshot(id,work_id,stage,path,created_at)
card.status: complete|incomplete (any §15 required field missing or below its count; reference fields judged from relation tables); server recomputes for every card whose data or relation rows a write touched (save, delete/restore incl. cascades), and for all cards on migration and backup import. Each table is created by the migration of the dev step that first uses it. No conversation table. FTS5 on card names. Save copies data refs into relation tables; card delete lists then deletes relation rows.

## 15 Schemas
Card: `{id, work_id, type, name, status complete|incomplete, source_notes, data, evidence{field:[sentence idx]}, ai_guess[field], pinned[field], schema_version}` (pinned → column pinned_fields).
data: character{theme, personality{traits[],behaviors[{situation,action}]}, speech{description,examples[≤5]}, appearance{summary,details}, relations[{target_id,relation}], origin_region_id}; region{parent_id, links[{target_id,travel{value>0,unit minute|hour|day,mode}?,direction?}], appearance, environment{natural,social}, sensory{smell,sound,mood}}; main_story{theme,premise,ending,milestones[{id,order,text}]}; part{order,title,theme,fulfills[],start,end,structure?}; episode{part_id,order,theme,relation_to_main,fulfills[],characters[],locations{main,others[]},links{prev,next,causes[]},foreshadowing{plants[{id fs_,text}],payoffs[fs_ id planted elsewhere]},worldline_id,structure{type 4|5,stages[{name,summary,tension 1–5}] = exactly 기승전결 or 발단…결말},synopsis}. Every data key is always present: undecided scalar or object (e.g. structure) = null, list = []. Source: `schemas/card/`.
Required (status): character name, theme, personality.traits ≥1, speech.description, speech.examples 3–5, appearance.summary; region name, appearance, environment.natural, environment.social; main_story theme, premise, ending, milestones ≥1; part title, theme, start, end; episode theme, synopsis, characters ≥1, locations.main, structure type + every stage summary. Others optional. Card data schemas validate shape only (no min counts, also in the card role output so the model can leave gaps); other role outputs keep their counts (e.g. pick 1–3); required-ness only via status. Region card responses add position{map_x,map_y} from the region table (not in data, never LLM output).
Sentences (evidence idx, highlight, changed): server splits notes after a run of . ? ! … followed by space/newline/end (not between digits, not inside quotes) and at every newline; empty pieces dropped; one rule for all uses, unit-tested with Korean samples.
Role outputs: `schemas/roles/` (SourceOutput, CardOutput per type). Also later: plan (§9), state values (§7), other JSON roles.

## 16 API
Base `http://127.0.0.1:{port}/api/v1`, `Authorization: Bearer {token}` on every route incl. /health (missing/wrong → 401 UNAUTHORIZED; AIPLOT_TOKEN required in every run). JSON, ISO 8601, chars incl. spaces. Error `{code,message,hint}`; each code maps to a UI state; framework codes VALIDATION_ERROR 422, NOT_FOUND, METHOD_NOT_ALLOWED, INTERNAL_ERROR 500, other statuses HTTP_{status}. Jobs return `202 {jobId}`. Locked → 423 STAGE_LOCKED.
- works: GET/POST /works; GET/PATCH/DELETE /works/{workId}; POST /works/{workId}/stage/advance; GET .../stage/reopen-preview?stage=; POST .../stage/reopen (title confirm if manuscript)
- cards: GET /works/{workId}/cards?type=&q=; GET /cards/{cardId}; PATCH /cards/{cardId} (region only, body {map_x,map_y} only; 423 when locked); GET /cards/{cardId}/references; DELETE /cards/{cardId}?reconnect=&episodes=; POST /cards/{cardId}/restore (within ~10s of delete; 423 if locked meanwhile); GET /works/{workId}/completeness; POST /cards/{cardId}/images (job); PUT /cards/{cardId}/image
- drafts: POST /works/{workId}/drafts; POST /drafts/{draftId}/messages (SSE reply, notes change, questions, name checks); PUT .../source; POST .../generate; POST .../save; DELETE /drafts/{draftId}
- direction: POST/GET /episodes/{episodeId}/plans (POST = job); POST /plans/{planId}/scenes/{scene}/pick; PATCH /plans/{planId} (order, cuts → recheck); POST /plans/{planId}/choose; POST /beats/{beatId}/feedback; GET /techniques?q=
- writing: GET /works/{workId}/chapters; POST /chapters/{chapterId}/generate (job); POST /beats/{beatId}/regenerate (job); PUT /beats/{beatId}/text; GET /beats/{beatId}/versions; POST /beats/{beatId}/versions/{version}/restore; GET /chapters/{chapterId}/warnings; PATCH /warnings/{warningId}; PATCH /chapters/{chapterId} (read, position)
- jobs: GET /jobs/{jobId}; GET /jobs/{jobId}/events (SSE); POST /jobs/{jobId}/pause|resume|cancel; GET /works/{workId}/jobs
- misc: POST /works/{workId}/export; POST /works/{workId}/backup; POST /backups/import; GET /health (model, VRAM); GET/PUT /settings
SSE order (chapter job):
```
progress {beat,total,etaSec}
beat_start {beatId}
sentence {beatId,text}
beat_done {beatId,chars,version}
state_update {cardId,key,value}
warning {warningId,beatId,kind}
beat_checked {beatId,warnings}
paused {reason}
done {chars,warnings,elapsedSec}
error {code}
```

## 17 Runtime
VRAM: peak ≤7.5GB; measured (RTX 3070 Laptop 8GB, b11982, `-ngl 99 -fa on -np 1`, f16 KV, ctx 8192 with 7.6k-token prompt): Q4_K_M 5.88GB, tg 66.6 t/s empty / 54.6 t/s at 7.6k; i1-Q5_K_M 6.59GB, 59.2 / 49.4 t/s; need more ctx → 8-bit KV. Evaluate LoRAs on the chosen base quant + F16 LoRA. Models downloaded in first run; ComfyUI on first image. Updates: GitHub Releases notify only; DB via migrations. Logs per process (`logs/server.log`, …), daily rotation, 14 days kept, failures + VRAM, never sent.

## 18 Training (training/ only)
Teacher LLM APIs allowed here; verify terms permit training on outputs.
- Direction LoRA (RAFT): input card bundle + 5 candidate techniques (some irrelevant) → per-scene picks + plan.
- Web novel LoRA: format data (teacher writes beats over genre × scene type × POV × tension) + style data (same instructions following the style framework and short story). Use exact `write` input format.
- Filter repetition/AI clichés; balance coverage. Pilot 2–3 seeds manually → automate → train Kaggle/Colab T4 QLoRA or paid fp16 on uncensored base (bf16 weights) → GGUF → eval on base quant + LoRA → ship only if passing. Version seeds, scripts, samples on private HF Hub. Add app beat feedback to later rounds.

## 19 Tests
Fake LLM fixtures only. Must cover: locks + 423 (incl. region position); PATCH /cards rejects non-region types and fields other than map_x/map_y; delete restore; no direct card field edits; snapshot before reopen; relation sync on save/delete; drafts/conversations not persisted; char count incl. spaces; SSE order; backup round-trip. E2E: library → contents → save card → generate. Model quality via training/eval scripts. CI: lint, typecheck, unit tests, e2e per PR and main push; Windows installer build (from unit 14).

## 20 Dev order (pass criteria; draft, blind human evals)
1. Monorepo, Electron↔server↔llama.cpp, model download, CI, schemas, SQLite, drawer, dex, map, story; minimal library/contents (create/open; full in 9); stage advance API + 423 (advance UI "연출 구성 시작" with reopen + snapshot in 3); eval notes in training/eval (Claude drafts, user reviews) — card field match ≥85% (30 notes, 6/type); unsupported fills ≤5%; JSON valid 100% w/ 1 retry; name check ≥90% found, ≤10% false; chat first char ≤2s, card ≤10s; measure real token counts.
2. Technique cards — ≥30, all fields; right technique within picks ≥80% of 20 scenes (single pick must be right).
3. Direction baseline, fix plan format; stage advance UI + reopen + snapshot — schema pass ≥95%.
4. Eval set — 20 bundles; rubric 1–5: tension placement, chapter cut, reveal timing, POV consistency, technique fit; no training overlap.
5. RAFT data + direction LoRA.
6. Compare picks-only / LoRA-only / both — +0.5 rubric, ≥60% blind win; cited technique matches applied ≥80%.
7. Writing, streaming, state, checks — length ±10% ≥90%; chapter ≤10min on AC; planted contradictions ≥80% found, ≤20% false; state ≥85%; repeated 3+ eojeol phrase ≤3/chapter.
8. Web novel LoRA — adopt if ≥60% blind win vs prompt-only.
9. Contents, reading, export, backup/import.
10. Images (optional).
11. Integration + installer — one episode (3–5 chapters) end to end; resume after forced quit; peak VRAM ≤7.5GB.
Defer if tight: images, hwp, node drag.
Step 1 units: 0 env/git · 1 skeleton+CI · 2 schemas · 3 server core+DB · 4 LLM layer · 5 real-model measurement (manually started llama-server via unit 4 client) · 6 jobs/SSE, llama process, download · 7 Electron+React shell, S0-1, min library · 8 works/cards API · 9 drafts API · 10 drawer · 11 dex · 12 map · 13 story · 14 E2E + installer CI · 15 eval.
**Current step: 1, unit 4.** Update when a unit/step passes.

## 21 Working rules
- Build only the current step unless asked. Small units; run checks before finishing.
- Every change via branch → PR to main (never push main); one topic per PR, Conventional Commit title. Review the PR; issues → fix and re-review until clean. Squash-merge only when review is clean and CI green (once CI exists).
- Language: code, comments, commits, CLAUDE.md in English; PR title/body and review comments in Korean (Conventional Commit type prefix kept); squash commit message set in English at merge.
- Unspecified decision → propose one option + short reason, ask first.
- Draft numbers must be measured; report and update this file.
- Design change → update this file in the same change; keep sections consistent.
- Keep this file terse: no rationale, no duplication.
