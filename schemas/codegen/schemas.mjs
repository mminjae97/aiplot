// Shared helpers: load and validate schema sources under schemas/.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

export const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..')
export const repoDir = join(schemasDir, '..')

// Top-level folders of schemas/ that hold tooling or examples, never schemas.
const skipTopDirs = new Set(['node_modules', 'codegen', 'fixtures'])
// Keywords whose values are data, not subschemas.
const dataKeywords = new Set(['const', 'default', 'enum', 'examples'])

function message(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Parses every schema once. Schemas live in subdirectories of schemas/ (the package root
 * holds tooling only); dot-dirs are ignored. Returns sorted posix paths for stable output.
 */
export function loadSchemas() {
  const schemas = []
  const errors = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!(dir === schemasDir && skipTopDirs.has(entry.name))) walk(full)
      } else if (dir !== schemasDir && entry.name.endsWith('.json')) {
        const rel = relative(schemasDir, full).split(sep).join('/')
        try {
          schemas.push({ rel, schema: JSON.parse(readFileSync(full, 'utf8')) })
        } catch (err) {
          errors.push(`${rel}: ${message(err)}`)
        }
      }
    }
  }
  walk(schemasDir)
  schemas.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return { schemas, errors }
}

/** Every `title` in a schema (root and nested subschemas); titles become type names. */
function collectTitles(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectTitles(item, out)
  } else if (node !== null && typeof node === 'object') {
    if (typeof node.title === 'string') out.push(node.title)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
        // Property names are keys here; their values are subschemas.
        for (const sub of Object.values(value ?? {})) collectTitles(sub, out)
      } else if (!dataKeywords.has(key)) {
        collectTitles(value, out)
      }
    }
  }
}

/** Codegen preconditions plus strict JSON Schema 2020-12 checks. Returns error messages. */
export function validateSchemas(schemas) {
  const errors = []
  const owners = new Map()
  for (const { rel, schema } of schemas) {
    if (typeof schema.title !== 'string' || schema.title === '') {
      errors.push(`${rel}: top-level "title" is required`)
    }
    const titles = []
    collectTitles(schema, titles)
    for (const title of titles) {
      // Generated types share one TS module, so every title must be unique repo-wide.
      if (owners.has(title)) errors.push(`${rel}: duplicate title ${title} (also in ${owners.get(title)})`)
      else owners.set(title, rel)
    }
  }

  const base = 'https://schemas.aiplot.invalid/'
  const ajv = new Ajv2020({ strict: true, allErrors: true })
  const added = []
  for (const { rel, schema } of schemas) {
    try {
      ajv.addSchema(schema, base + rel)
      added.push(rel)
    } catch (err) {
      errors.push(`${rel}: ${message(err)}`)
    }
  }
  for (const rel of added) {
    try {
      ajv.getSchema(base + rel)
    } catch (err) {
      errors.push(`${rel}: ${message(err)}`)
    }
  }
  return errors
}
