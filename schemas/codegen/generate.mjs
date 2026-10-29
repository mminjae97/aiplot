// Generates app/src/types (TypeScript) and server/aiplot/generated (Pydantic) from schemas/.
// Both outputs are built in a temp dir and replace the committed ones only if both succeed.
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
import { checkTitles, listSchemas, readSchema, repoDir, schemasDir } from './schemas.mjs'

const header = 'GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.'
const tsOut = join(repoDir, 'app', 'src', 'types')
const pyOut = join(repoDir, 'server', 'aiplot', 'generated')
const serverDir = join(repoDir, 'server')

const schemas = listSchemas()
if (schemas.length === 0) throw new Error('no schemas found')
const titleErrors = checkTitles(schemas)
if (titleErrors.length > 0) throw new Error(titleErrors.join('\n'))

async function generateTypeScript(outDir) {
  // Same style as the app's own sources.
  const style = JSON.parse(readFileSync(join(repoDir, 'app', '.prettierrc.json'), 'utf8'))
  const parts = []
  for (const rel of schemas) {
    const schema = readSchema(rel)
    // Referenced types are declared by their own file's compile, so each appears exactly once.
    parts.push(
      await compile(schema, schema.title, {
        cwd: dirname(join(schemasDir, rel)),
        bannerComment: '',
        declareExternallyReferenced: false,
        additionalProperties: false,
        strictIndexSignatures: true,
        style,
      }),
    )
  }
  writeFileSync(join(outDir, 'index.ts'), `/* ${header} */\n\n${parts.join('\n')}`)
}

function generatePython(outDir, stage) {
  // Stage only schema files so datamodel-codegen never sees package.json or codegen/.
  for (const rel of schemas) {
    const target = join(stage, rel)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(schemasDir, rel), target)
  }
  const args = [
    'run',
    '--locked',
    '--project',
    serverDir,
    'datamodel-codegen',
    '--input',
    stage,
    '--input-file-type',
    'jsonschema',
    '--output',
    outDir,
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
  ]
  const result = spawnSync('uv', args, { cwd: serverDir, stdio: 'inherit' })
  if (result.error) throw new Error(`could not run uv: ${result.error.message}`)
  if (result.signal) throw new Error(`datamodel-codegen killed by ${result.signal}`)
  if (result.status !== 0) throw new Error(`datamodel-codegen exited with ${result.status}`)
  writeFileSync(join(outDir, '__init__.py'), `# ${header}\n`)
}

// Generated files are committed; keep them LF on every OS.
function normalizeEol(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) normalizeEol(full)
    else writeFileSync(full, readFileSync(full, 'utf8').replace(/\r\n/g, '\n'))
  }
}

function replaceDir(from, to) {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}

const work = mkdtempSync(join(tmpdir(), 'aiplot-codegen-'))
try {
  const tsTmp = join(work, 'ts')
  const pyTmp = join(work, 'py')
  mkdirSync(tsTmp)
  await generateTypeScript(tsTmp)
  generatePython(pyTmp, join(work, 'stage'))
  normalizeEol(tsTmp)
  normalizeEol(pyTmp)
  replaceDir(tsTmp, tsOut)
  replaceDir(pyTmp, pyOut)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`generated ${schemas.length} schemas -> app/src/types, server/aiplot/generated`)
