// Two versions of a beat's text compared (§10 S3-1: versions compare), word by word: what an
// earlier version had that the current one dropped, and what the current one added.

export type DiffPiece = { kind: 'same' | 'removed' | 'added'; text: string }

// The comparison table's cells (Uint32, 4 bytes each): a beat is ~800 chars, an edited one
// ≤20000; past this the words are compared line by line, then as wholes.
const MAX_CELLS = 2_000_000

/** Words (Korean eojeol) and the spaces between them, or lines with their break. */
function tokens(text: string, by: 'word' | 'line'): string[] {
  return (by === 'word' ? text.match(/\S+|\s+/g) : text.match(/[^\n]*\n|[^\n]+/g)) ?? []
}

/** Each change told as all it removed, then all it added: spaces left alike between changed
 * words go into both, so a rewritten phrase reads as one. */
function regroup(pieces: readonly DiffPiece[]): DiffPiece[] {
  const out: DiffPiece[] = []
  let removed = ''
  let added = ''
  const flush = () => {
    if (removed) out.push({ kind: 'removed', text: removed })
    if (added) out.push({ kind: 'added', text: added })
    removed = ''
    added = ''
  }
  pieces.forEach((piece, at) => {
    const next = pieces[at + 1]
    const between = (removed !== '' || added !== '') && next !== undefined && next.kind !== 'same'
    if (piece.kind === 'removed') removed += piece.text
    else if (piece.kind === 'added') added += piece.text
    else if (between && piece.text.trim() === '') {
      removed += piece.text
      added += piece.text
    } else {
      flush()
      const last = out[out.length - 1]
      if (last?.kind === 'same') last.text += piece.text
      else out.push({ ...piece })
    }
  })
  flush()
  return out
}

/** The pieces in order, runs of one kind joined; null when the texts are too long apart. */
function compare(a: readonly string[], b: readonly string[]): DiffPiece[] | null {
  // The same start and end are left out of the table.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const n = endA - start
  const m = endB - start
  if ((n + 1) * (m + 1) > MAX_CELLS) return null
  // common[i * width + j] = the longest common run of a[start+i..endA) and b[start+j..endB).
  const width = m + 1
  const common = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        a[start + i] === b[start + j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
    }
  }
  const out: DiffPiece[] = []
  const push = (kind: DiffPiece['kind'], text: string | undefined) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  for (const token of a.slice(0, start)) push('same', token)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      push('same', a[start + i])
      i += 1
      j += 1
    } else if ((common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0)) {
      push('removed', a[start + i])
      i += 1
    } else {
      push('added', b[start + j])
      j += 1
    }
  }
  for (; i < n; i += 1) push('removed', a[start + i])
  for (; j < m; j += 1) push('added', b[start + j])
  for (const token of a.slice(endA)) push('same', token)
  return out
}

/** The pieces with long unchanged runs cut down to `keep` characters (code points) next to
 * each change, so the changes show without scrolling through the whole beat. */
export function elide(pieces: readonly DiffPiece[], keep = 40): DiffPiece[] {
  return pieces.map((piece, at) => {
    const points = Array.from(piece.text)
    // A change before it keeps its head, one after it its tail.
    const head = at > 0 ? points.slice(0, keep).join('') : null
    const tail = at < pieces.length - 1 ? points.slice(-keep).join('') : null
    const kept = (head === null ? 0 : keep) + (tail === null ? 0 : keep)
    if (piece.kind !== 'same' || (head === null && tail === null) || points.length <= kept + 3) {
      return piece
    }
    // The mark sits by the words it stands next to, not alone on a line of its own.
    const start = head?.trimEnd()
    const end = tail?.trimStart()
    const text =
      start !== undefined && end !== undefined
        ? `${start} … ${end}`
        : start !== undefined
          ? `${start} …`
          : `… ${end ?? ''}`
    return { kind: 'same', text }
  })
}

/** `before` turned into `after`: the pieces joined without the added ones give `before`,
 * without the removed ones `after`. */
export function textDiff(before: string, after: string): DiffPiece[] {
  for (const by of ['word', 'line'] as const) {
    const pieces = compare(tokens(before, by), tokens(after, by))
    if (pieces) return regroup(pieces)
  }
  return [
    { kind: 'removed' as const, text: before },
    { kind: 'added' as const, text: after },
  ].filter((piece) => piece.text !== '')
}
