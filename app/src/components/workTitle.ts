// Work titles as the server takes them (server/aiplot/services/works.py clean_title): runs of
// whitespace become one space, the ends are trimmed, and at most 100 code points remain.

export const TITLE_MAX = 100

// Python's str.split() whitespace, exactly: JS \s also has U+FEFF and lacks U+001C-U+001F
// (control characters Python splits on) and U+0085.
const WHITESPACE =
  // eslint-disable-next-line no-control-regex
  /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/

export function cleanTitle(title: string): string {
  return title.split(WHITESPACE).filter(Boolean).join(' ')
}

/** Code points, as Python's len(): an emoji or other astral character counts once (not as
 * UTF-16 units, nor as one grapheme for a joined emoji sequence). */
export function titleLength(clean: string): number {
  return Array.from(clean).length
}

export function titleTooLong(clean: string): boolean {
  return titleLength(clean) > TITLE_MAX
}
