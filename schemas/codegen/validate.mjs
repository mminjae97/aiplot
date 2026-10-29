// Checks every schema against JSON Schema 2020-12 (strict) and resolves cross-file $refs.
import Ajv2020 from 'ajv/dist/2020.js'
import { listSchemas, readSchema } from './schemas.mjs'

const base = 'https://schemas.aiplot.invalid/'
const ajv = new Ajv2020({ strict: true, allErrors: true })
const schemas = listSchemas()
for (const rel of schemas) ajv.addSchema(readSchema(rel), base + rel)

let failed = 0
for (const rel of schemas) {
  try {
    ajv.getSchema(base + rel)
  } catch (err) {
    failed += 1
    console.error(`${rel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
if (failed > 0) process.exit(1)
console.log(`${schemas.length} schemas valid`)
