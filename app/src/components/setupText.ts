// How the first-run screen and the top-bar chip put setup progress into words (§5).
import { strings } from '../strings'

const GB = 1024 ** 3
const MB = 1024 ** 2

export function formatBytes(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)}GB` : `${String(Math.ceil(bytes / MB))}MB`
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return '1분 미만'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `약 ${String(minutes)}분`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `약 ${String(hours)}시간` : `약 ${String(hours)}시간 ${String(rest)}분`
}

/** The server's step ("<file>" or "verify <file>") in words (§5: Korean UI text). */
export function stepText(step: string | null): string {
  if (!step) return strings.setup.preparing
  const verify = step.startsWith('verify ')
  const file = verify ? step.slice('verify '.length) : step
  const what = file.endsWith('.gguf') ? strings.setup.model : strings.setup.llama
  return verify ? strings.setup.verifying(what) : strings.setup.downloading(what)
}

export function percentOf(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0
}
