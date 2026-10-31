// How a card reads in the drawer's preview (§8): one row per field path, with what the
// field needs (required, evidence, AI 추정) and its value as text.
import { strings } from '../strings'
import type { CardOutput } from '../types'

// Required fields per type (§15), mirrored from the server's status rule.
const REQUIRED: Record<CardOutput['type'], readonly string[]> = {
  world: ['name', 'category', 'summary'],
  character: [
    'name',
    'theme',
    'personality.traits',
    'speech.description',
    'speech.examples',
    'appearance.summary',
  ],
  region: ['name', 'appearance', 'environment.natural', 'environment.social'],
  main_story: ['theme', 'premise', 'ending', 'milestones'],
  part: ['title', 'theme', 'start', 'end'],
  episode: ['theme', 'synopsis', 'characters', 'locations.main', 'structure'],
}

// Placement the story screen owns; the preview leaves it out (§13).
const HIDDEN = new Set(['part_id', 'order', 'links.prev', 'links.next', 'worldline_id'])

export type FieldRow = {
  path: string
  label: string
  value: unknown
  required: boolean
  empty: boolean
  /** No evidence sentence, or the model said it inferred it: shown as AI 추정 (§8). */
  guessed: boolean
  evidence: number[]
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Not there yet as §15 counts it: 3–5 speech examples, a structure with a type and every
 * stage summarised; otherwise just empty. */
export function undecided(path: string, value: unknown): boolean {
  if (path === 'speech.examples') {
    return !Array.isArray(value) || value.length < 3 || value.length > 5
  }
  if (path === 'structure') {
    if (value === null || typeof value !== 'object') return true
    const structure = value as { type?: unknown; stages?: unknown }
    if (structure.type == null || !Array.isArray(structure.stages)) return true
    return (structure.stages as { summary?: unknown }[]).some((stage) => isEmpty(stage.summary))
  }
  return isEmpty(value)
}

export function labelOf(path: string): string {
  return strings.fields[path] ?? path
}

function at(value: unknown, path: string): unknown {
  let current = value
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Field paths of a card in display order: name, then data keys, nested objects one level. */
export function fieldPaths(card: CardOutput): string[] {
  const paths =
    card.type === 'world' || card.type === 'character' || card.type === 'region' ? ['name'] : []
  for (const [key, value] of Object.entries(card.data)) {
    const nested =
      value !== null && typeof value === 'object' && !Array.isArray(value) && key !== 'structure'
    if (nested) {
      for (const sub of Object.keys(value as Record<string, unknown>)) paths.push(`${key}.${sub}`)
    } else {
      paths.push(key)
    }
  }
  return paths.filter((path) => !HIDDEN.has(path))
}

export function valueOf(card: { name: string | null; data: object }, path: string): unknown {
  return path === 'name' ? card.name : at(card.data, path)
}

export function rows(card: CardOutput): FieldRow[] {
  const required = REQUIRED[card.type]
  return fieldPaths(card).map((path) => {
    const value = valueOf(card, path)
    const evidence = card.evidence[path] ?? []
    const isRequired = required.includes(path)
    const empty = isRequired ? undecided(path, value) : isEmpty(value)
    return {
      path,
      label: labelOf(path),
      value,
      required: isRequired,
      empty,
      guessed: !empty && (evidence.length === 0 || card.ai_guess.includes(path)),
      evidence,
    }
  })
}

/** A field's value as one line of text; card ids read as card names. */
export function display(value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return names.get(value) ?? value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => display(item, names)).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    // Structure: its kind, then its stages, one per line.
    if (Array.isArray(record.stages)) {
      const kind = typeof record.type === 'number' ? `${String(record.type)}단계\n` : ''
      return (
        kind +
        (record.stages as Record<string, unknown>[])
          .map((stage) => `${String(stage.name)}: ${display(stage.summary, names) || '—'}`)
          .join('\n')
      )
    }
    // A milestone or a planted foreshadowing reads as its text, never its id.
    if (typeof record.id === 'string' && typeof record.text === 'string') return record.text
    return Object.values(record)
      .map((item) => display(item, names))
      .filter(Boolean)
      .join(' — ')
  }
  return ''
}

/** Same value? (order-sensitive; for the edit-mode diff) */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}
