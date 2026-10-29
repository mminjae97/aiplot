// `npm test`: validates every schema and fixture without generating anything.
import { loadValidSchemas, validateFixtures } from './schemas.mjs'

const { schemas, errors, ajv } = loadValidSchemas()
let count = 0
if (errors.length === 0) {
  const fixtures = validateFixtures(schemas, ajv)
  errors.push(...fixtures.errors)
  count = fixtures.count
}
if (errors.length > 0) {
  for (const line of errors) console.error(line)
  process.exit(1)
}
console.log(`${schemas.length} schemas valid, ${count} fixtures checked`)
