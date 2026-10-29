// `npm test`: validates every schema without generating anything.
import { loadSchemas, validateSchemas } from './schemas.mjs'

const { schemas, errors } = loadSchemas()
errors.push(...validateSchemas(schemas))
if (errors.length > 0) {
  for (const line of errors) console.error(line)
  process.exit(1)
}
console.log(`${schemas.length} schemas valid`)
