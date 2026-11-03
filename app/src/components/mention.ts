// Whether a chat message still names an @ card (§8). The particle rule mirrors the server's
// similar-name check (server/aiplot/services/names.py, PARTICLES and stems): a name may carry
// particles, stacked ones too (@레오에게는), and nothing else.

// Particles and endings that follow a name in a sentence; vocative 아/야 left out as there.
// prettier-ignore
const PARTICLES = [
  '에게서', '한테서', '으로부터', '이랑', '에서', '에게', '한테', '께서', '으로', '이나',
  '이며', '이고', '이었다', '였다', '이다', '이자', '처럼', '까지', '부터', '보다', '하고',
  '님', '씨', '은', '는',
  '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '랑',
].sort((a, b) => b.length - a.length)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when the letters are particles only, taken off the end in turn (에게는 → 에게 → ''),
 * the longest first, as the server strips them. */
function particlesOnly(tail: string): boolean {
  let rest = tail
  while (rest) {
    const particle = PARTICLES.find((p) => rest.endsWith(p))
    if (particle === undefined) return false
    rest = rest.slice(0, -particle.length)
  }
  return true
}

/** True when the message still names the card as a whole @word, particles allowed
 * (@레오가, not @레오 in @레오나). */
export function mentions(message: string, name: string): boolean {
  if (!name) return false
  // The word letters right after the name ([\w가-힣] on the server).
  const pattern = new RegExp(`@${escapeRegExp(name)}([\\p{L}\\p{N}_]*)`, 'gu')
  for (const match of message.matchAll(pattern)) {
    if (particlesOnly(match[1] ?? '')) return true
  }
  return false
}
