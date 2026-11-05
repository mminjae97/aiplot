import { strings } from '../strings'

/** A drawer error code as the user reads it. */
export function errorText(code: string): string {
  return strings.drawer.errors[code] ?? strings.drawer.failed
}

export function saveErrorText(code: string): string {
  if (code === 'CARD_STALE') return strings.preview.stale
  if (code === 'CARD_CONFLICT') return strings.preview.conflict
  return strings.drawer.errors[code] ?? strings.preview.saveFailed
}
