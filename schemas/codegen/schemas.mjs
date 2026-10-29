// Shared helpers: locate and check schema sources under schemas/.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..')
export const repoDir = join(schemasDir, '..')

// Schemas live in subdirectories of schemas/ (e.g. common/); the package root holds tooling only.
const skipDirs = new Set(['node_modules', 'codegen', 'fixtures'])

/** Schema files as posix paths relative to schemas/, sorted for stable output. */
export function listSchemas() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full)
      } else if (dir !== schemasDir && entry.name.endsWith('.json')) {
        found.push(relative(schemasDir, full).split(sep).join('/'))
      }
    }
  }
  walk(schemasDir)
  return found.sort()
}

export function readSchema(rel) {
  return JSON.parse(readFileSync(join(schemasDir, rel), 'utf8'))
}

/** Codegen preconditions: every schema has a unique top-level title. Returns error messages. */
export function checkTitles(schemas) {
  const errors = []
  const seen = new Map()
  for (const rel of schemas) {
    const { title } = readSchema(rel)
    if (typeof title !== 'string' || title === '') {
      errors.push(`${rel}: top-level "title" is required`)
    } else if (seen.has(title)) {
      errors.push(`${rel}: duplicate title ${title} (also in ${seen.get(title)})`)
    } else {
      seen.set(title, rel)
    }
  }
  return errors
}
