// Book colours (§12 책 꾸미기): the spine always, and the cloth cover when there is no
// illustration. Cover lettering keeps at least 4.5:1 on every colour (§5).

/** Cloth presets: muted, so the brass stays the accent. The first seven are also the defaults. */
export const PRESETS = [
  { color: '#6e2c28', name: '버건디' },
  { color: '#2f4a3a', name: '숲초록' },
  { color: '#2c3a55', name: '남색' },
  { color: '#6b4f22', name: '황토' },
  { color: '#465156', name: '청회색' },
  { color: '#5a3a4f', name: '자두색' },
  { color: '#3f3428', name: '고동색' },
] as const

// Gilt on dark cloth; dark ink once the cloth is too light for gilt (styles/base.css).
const GILT = '#e8c877'
const INK = '#2e2219'
export const MIN_CONTRAST = 4.5

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable per work: a book the user never coloured keeps its binding on every visit. */
export function bindingOf(id: string): string {
  return PRESETS[hash(id) % PRESETS.length]?.color ?? '#3f3428'
}

export function colorOf(work: { id: string; color: string | null }): string {
  return work.color ?? bindingOf(work.id)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const [r = 0, g = 0, b = 0] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** Gilt where it reads, dark ink on light cloth, plain white or black on the few mid tones
 * where neither reaches 4.5:1. */
export function letteringOf(cloth: string): string {
  for (const ink of [GILT, INK]) if (contrast(ink, cloth) >= MIN_CONTRAST) return ink
  return contrast('#ffffff', cloth) >= contrast('#000000', cloth) ? '#ffffff' : '#000000'
}
