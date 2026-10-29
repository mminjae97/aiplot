// Checks every schema against JSON Schema 2020-12 (strict), resolves cross-file $refs,
// and enforces the codegen preconditions.
import Ajv2020 from 'ajv/dist/2020.js'
import { checkTitles, listSchemas, readSchema } from './schemas.mjs'

const base = 'https://schemas.aiplot.invalid/'
const ajv = new Ajv2020({ strict: true, allErrors: true })
const schemas = listSchemas()
const errors = checkTitles(schemas)

const added = []
for (const rel of schemas) {
  try {
    ajv.addSchema(readSchema(rel), base + rel)
    added.push(rel)
  } catch (err) {
    errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
for (const rel of added) {
  try {
    ajv.getSchema(base + rel)
  } catch (err) {
    errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (errors.length > 0) {
  for (const message of errors) console.error(message)
  process.exit(1)
}
console.log(`${schemas.length} schemas valid`)
