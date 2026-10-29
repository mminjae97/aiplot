// `npm test`: validates every schema and fixture without generating anything.
import { listFixtures, loadValidSchemas, validateFixtures } from './schemas.mjs'

const { schemas, errors } = loadValidSchemas()
if (errors.length === 0) errors.push(...validateFixtures(schemas))
if (errors.length > 0) {
  for (const line of errors) console.error(line)
  process.exit(1)
}
console.log(`${schemas.length} schemas valid, ${listFixtures().length} fixtures checked`)
