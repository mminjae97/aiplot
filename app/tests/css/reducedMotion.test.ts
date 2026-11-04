// @vitest-environment node
// Stylesheets read as text: Vitest hands CSS imports over empty.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const STYLES = join(import.meta.dirname, '..', '..', 'src', 'styles')

/** Rules inside `@media (prefers-reduced-motion: reduce)` blocks, flattened to one string. */
function reducedRules(css: string): string {
  let out = ''
  const head = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g
  for (let match = head.exec(css); match; match = head.exec(css)) {
    let depth = 1
    let at = head.lastIndex
    while (depth > 0 && at < css.length) {
      if (css[at] === '{') depth += 1
      else if (css[at] === '}') depth -= 1
      at += 1
    }
    out += css.slice(head.lastIndex, at - 1)
  }
  return out
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('no animation runs forever under reduced motion (§5)', () => {
  const files = readdirSync(STYLES).filter((file) => file.endsWith('.css'))
  expect(files.length).toBeGreaterThan(0)
  let endlessSeen = 0
  for (const name of files) {
    const css = readFileSync(join(STYLES, name), 'utf8')
    const reduced = reducedRules(css)
    // Each selector with an endless animation is stopped in a reduced-motion block.
    const endless = /([^{}]+)\{[^{}]*animation:[^;{}]*\binfinite\b[^{}]*\}/g
    for (let match = endless.exec(css); match; match = endless.exec(css)) {
      endlessSeen += 1
      const selector = (match[1] ?? '').trim()
      const stopped = new RegExp(`${escape(selector)}\\s*\\{[^{}]*animation:\\s*none`)
      expect(stopped.test(reduced), `${name}: ${selector}`).toBe(true)
    }
  }
  // The spinner at least: the check reads real rules.
  expect(endlessSeen).toBeGreaterThan(0)
})
