// @vitest-environment node
// Stylesheets read as text: Vitest hands CSS imports over empty.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'src')
const STYLES = join(SRC, 'styles')
// src/cursor.ts's selector, read as text (this project type-checks without the DOM).
const CLICKABLE =
  /const CLICKABLE =\s*'([^']+)'/.exec(readFileSync(join(SRC, 'cursor.ts'), 'utf8'))?.[1] ?? ''

/** Every rule setting `cursor`, as [file, selector, value]. */
function cursorRules(): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const name of readdirSync(STYLES).filter((file) => file.endsWith('.css'))) {
    const css = readFileSync(join(STYLES, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /([^{}]+)\{([^{}]*)\}/g
    for (let match = rule.exec(css); match; match = rule.exec(css)) {
      const value = /(?:^|[;\s])cursor:\s*([^;]+)/.exec(match[2] ?? '')?.[1]
      if (value) out.push([name, (match[1] ?? '').trim().replace(/\s+/g, ' '), value.trim()])
    }
  }
  return out
}

const list = (selectors: string) =>
  selectors
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/"/g, "'")
        .replace(/:not\(:disabled\)$/, ''),
    )
    .sort()

test('CSS gives the gilt quill to what src/cursor.ts calls clickable (§5)', () => {
  const rules = cursorRules()
  const gilt = rules.find(
    ([name, selector, value]) =>
      name === 'base.css' && selector.startsWith(':where(') && value === 'var(--cursor-pointer)',
  )
  expect(gilt).toBeDefined()
  expect(list(gilt?.[1].slice(':where('.length, -1) ?? '')).toEqual(list(CLICKABLE))
})

// Relation graph and region map nodes keep the plain quill (§5); src/cursor.ts never counts
// them clickable either.
const NODES = ['.dex-graph .react-flow__node', '.map-node']

test('the plain quill goes only to the page, graph and map nodes and disabled things (§5)', () => {
  // A clickable thing given the plain quill disagrees with the gilt one src/cursor.ts draws
  // for it at the window edges.
  const plain = cursorRules().filter(([, , value]) => value === 'var(--cursor)')
  expect(plain.length).toBeGreaterThan(0)
  for (const [name, selector] of plain) {
    const disabled = selector
      .split(',')
      .every((part) => /:disabled|\[aria-disabled='true'\]/.test(part))
    expect(
      selector === 'html' || NODES.includes(selector) || disabled,
      `${name}: ${selector}`,
    ).toBe(true)
  }
})
