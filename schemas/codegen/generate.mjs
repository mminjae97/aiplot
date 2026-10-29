// Generates app/src/types (TypeScript) and server/aiplot/generated (Pydantic) from schemas/.
// Both outputs are built in a temp dir; committed outputs change only if everything succeeds.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compile } from 'json-schema-to-typescript'
import { loadSchemas, repoDir, schemasDir, validateSchemas } from './schemas.mjs'

const header = 'GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.'
const tsOut = join(repoDir, 'app', 'src', 'types')
const pyOut = join(repoDir, 'server', 'aiplot', 'generated')
const serverDir = join(repoDir, 'server')
const serverConfig = join(serverDir, 'pyproject.toml')
const registryName = 'SchemaRegistry'

const { schemas, errors } = loadSchemas()
errors.push(...validateSchemas(schemas))
if (schemas.length === 0) errors.push('no schemas found')
if (errors.length > 0) throw new Error(`invalid schemas:\n${errors.join('\n')}`)

async function generateTypeScript(outDir) {
  // One compile through a registry declares every named type (incl. $defs and nested titles)
  // exactly once; the registry itself is internal and removed afterwards.
  const properties = Object.fromEntries(
    schemas.map(({ rel, schema }) => [schema.title, { $ref: `./${rel}` }]),
  )
  const style = JSON.parse(readFileSync(join(repoDir, 'app', '.prettierrc.json'), 'utf8'))
  const ts = await compile(
    { title: registryName, type: 'object', additionalProperties: false, properties },
    registryName,
    {
      cwd: schemasDir,
      bannerComment: `/* ${header} */`,
      strictIndexSignatures: true,
      // Bounded arrays stay T[]; counts are enforced by the server, not tuple unions.
      maxItems: -1,
      style,
    },
  )
  const registry = new RegExp(`^export interface ${registryName} \\{\\n[\\s\\S]*?^\\}\\n`, 'm')
  if (!registry.test(ts)) throw new Error(`${registryName} block not found in TS output`)
  writeFileSync(join(outDir, 'index.ts'), ts.replace(registry, ''))
}

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: serverDir, stdio: 'inherit' })
  if (result.error) throw new Error(`could not run ${command} (${label}): ${result.error.message}`)
  if (result.signal) throw new Error(`${label} killed by ${result.signal}`)
  if (result.status !== 0) throw new Error(`${label} exited with ${result.status}`)
}

function generatePython(outDir, stage) {
  // Stage only schema files so datamodel-codegen never sees package.json or codegen/.
  for (const { rel } of schemas) {
    const target = join(stage, rel)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(schemasDir, rel), target)
  }
  const uv = ['run', '--locked', '--project', serverDir]
  run('datamodel-codegen', 'uv', [
    ...uv,
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
  ])
  writeFileSync(join(outDir, '__init__.py'), `# ${header}\n`)
  // Same ruff settings as the server package: sorted imports, line length.
  run('ruff check', 'uv', [...uv, 'ruff', 'check', '--config', serverConfig, '--select', 'I', '--fix', '--quiet', outDir])
  run('ruff format', 'uv', [...uv, 'ruff', 'format', '--config', serverConfig, '--quiet', outDir])
}

// Generated files are committed; keep them LF on every OS.
function normalizeEol(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) normalizeEol(full)
    else writeFileSync(full, readFileSync(full, 'utf8').replace(/\r\n/g, '\n'))
  }
}

/** Replaces every target with its new build; on any failure restores all previous targets. */
function replaceAll(pairs) {
  const backups = []
  try {
    for (const { from, to } of pairs) {
      const backup = `${to}.bak`
      rmSync(backup, { recursive: true, force: true })
      if (existsSync(to)) {
        renameSync(to, backup)
        backups.push({ to, backup })
      } else {
        backups.push({ to, backup: null })
      }
      cpSync(from, to, { recursive: true })
    }
  } catch (err) {
    for (const { to, backup } of backups.reverse()) {
      rmSync(to, { recursive: true, force: true })
      if (backup) renameSync(backup, to)
    }
    throw err
  }
  for (const { backup } of backups) if (backup) rmSync(backup, { recursive: true, force: true })
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
  replaceAll([
    { from: tsTmp, to: tsOut },
    { from: pyTmp, to: pyOut },
  ])
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`generated ${schemas.length} schemas -> app/src/types, server/aiplot/generated`)
