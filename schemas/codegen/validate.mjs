// `npm test`: validates every schema without generating anything.
import { loadValidSchemas } from './schemas.mjs'

const { schemas, errors } = loadValidSchemas()
if (errors.length > 0) {
  for (const line of errors) console.error(line)
  process.exit(1)
}
console.log(`${schemas.length} schemas valid`)
