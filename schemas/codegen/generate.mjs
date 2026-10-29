// Generates app/src/types (TypeScript) and server/aiplot/generated (Pydantic) from schemas/.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compile } from 'json-schema-to-typescript'
import { listSchemas, readSchema, repoDir, schemasDir } from './schemas.mjs'

const header = 'GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.'
const tsOut = join(repoDir, 'app', 'src', 'types')
const pyOut = join(repoDir, 'server', 'aiplot', 'generated')

const schemas = listSchemas()
if (schemas.length === 0) throw new Error('no schemas found')

async function generateTypeScript() {
  // One registry schema referencing every file, so each type is declared exactly once.
  const properties = {}
  for (const rel of schemas) {
    const { title } = readSchema(rel)
    if (!title) throw new Error(`${rel}: top-level "title" is required`)
    if (properties[title]) throw new Error(`${rel}: duplicate title ${title}`)
    properties[title] = { $ref: `./${rel}` }
  }
  const registry = {
    title: 'SchemaRegistry',
    description: 'Index of all schema types; not an API payload.',
    type: 'object',
    additionalProperties: false,
    properties,
  }
  const ts = await compile(registry, 'SchemaRegistry', {
    cwd: schemasDir,
    bannerComment: `/* ${header} */`,
    additionalProperties: false,
    strictIndexSignatures: true,
    style: { semi: false, singleQuote: true, printWidth: 100, trailingComma: 'all' },
  })
  rmSync(tsOut, { recursive: true, force: true })
  mkdirSync(tsOut, { recursive: true })
  writeFileSync(join(tsOut, 'index.ts'), ts)
}

function generatePython() {
  // Stage only schema files so datamodel-codegen never sees package.json or codegen/.
  const stage = mkdtempSync(join(tmpdir(), 'aiplot-schemas-'))
  try {
    for (const rel of schemas) {
      const target = join(stage, rel)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(schemasDir, rel), target)
    }
    rmSync(pyOut, { recursive: true, force: true })
    const result = spawnSync(
      'uv',
      [
        'run',
        '--project',
        join(repoDir, 'server'),
        'datamodel-codegen',
        '--input',
        stage,
        '--input-file-type',
        'jsonschema',
        '--output',
        pyOut,
        '--output-model-type',
        'pydantic_v2.BaseModel',
        '--target-python-version',
        '3.12',
        '--use-title-as-name',
        '--use-standard-collections',
        '--use-union-operator',
        '--use-annotated',
        '--field-constraints',
        '--use-double-quotes',
        '--disable-timestamp',
        '--custom-file-header',
        `# ${header}`,
        '--formatters',
        'ruff-format',
      ],
      { cwd: join(repoDir, 'server'), stdio: 'inherit' },
    )
    if (result.status !== 0) throw new Error(`datamodel-codegen failed (${result.status})`)
    writeFileSync(join(pyOut, '__init__.py'), `# ${header}\n`)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

// Generated files are committed; keep them LF on every OS.
function normalizeEol(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) normalizeEol(full)
    else writeFileSync(full, readFileSync(full, 'utf8').replace(/\r\n/g, '\n'))
  }
}

await generateTypeScript()
generatePython()
normalizeEol(tsOut)
normalizeEol(pyOut)
console.log(`generated ${schemas.length} schemas -> app/src/types, server/aiplot/generated`)
