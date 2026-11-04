// @vitest-environment node
// Stylesheets read as text: Vitest hands CSS imports over empty.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const STYLES = join(import.meta.dirname, '..', '..', 'src', 'styles')

/** Every rule setting `cursor`, as [file, selector, value]. */
function cursorRules(): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const name of readdirSync(STYLES).filter((file) => file.endsWith('.css'))) {
    // Comments and @import statements are not part of any selector.
    const css = readFileSync(join(STYLES, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import[^;]*;/g, '')
    const rule = /([^{}]+)\{([^{}]*)\}/g
    for (let match = rule.exec(css); match; match = rule.exec(css)) {
      const value = /(?:^|[;\s])cursor:\s*([^;]+)/.exec(match[2] ?? '')?.[1]
      if (value) out.push([name, (match[1] ?? '').trim().replace(/\s+/g, ' '), value.trim()])
    }
  }
  return out
}

// The cursors the app draws (§5): the quill everywhere but the relation graph and the map,
// which show only the paperweight, pressed while anything there is dragged; the I-beam in text
// fields; none where src/cursor.ts draws the image itself; inherit for boxes inside a label.
const ALLOWED = [
  'var(--cursor)',
  'var(--cursor-drag) !important',
  'var(--cursor-dragging) !important',
  'text',
  'none !important',
  'inherit',
]

test('no rule gives another cursor: no gilt quill, no hand or arrow (§5)', () => {
  const rules = cursorRules()
  expect(rules.length).toBeGreaterThan(0)
  for (const [name, selector, value] of rules) {
    expect(ALLOWED, `${name}: ${selector} { cursor: ${value} }`).toContain(value)
  }
})

test('buttons, links and labels get the quill over the arrow and hand Chromium gives them (§5)', () => {
  const quill = cursorRules().find(
    ([name, selector, value]) =>
      name === 'base.css' && selector.startsWith(':where(') && value === 'var(--cursor)',
  )
  for (const part of ['button', 'a[href]', 'label', 'summary', "[role='button']", "[role='tab']"]) {
    expect(quill?.[1]).toContain(part)
  }
})
