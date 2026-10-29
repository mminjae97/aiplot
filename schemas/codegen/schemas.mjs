// Shared helpers: locate schema sources under schemas/.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..')
export const repoDir = join(schemasDir, '..')

const skipDirs = new Set(['node_modules', 'codegen'])
const skipFiles = new Set(['package.json', 'package-lock.json'])

/** Schema files as posix paths relative to schemas/, sorted for stable output. */
export function listSchemas() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full)
      } else if (entry.name.endsWith('.json') && !skipFiles.has(entry.name)) {
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
