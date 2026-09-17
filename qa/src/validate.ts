/** Structural manifest check — native adapter compliance gate.
 *  usage: bun src/validate.ts <manifest.json> */
import { validateManifest } from "./types.ts"

const path = process.argv[2]
if (path === undefined) {
  console.error("usage: bun src/validate.ts <manifest.json>")
  process.exit(2)
}
const raw: unknown = JSON.parse(await Bun.file(path).text())
const errors = validateManifest(raw)
if (errors.length === 0) {
  console.log(`OK ${path}`)
  process.exit(0)
}
console.error(`INVALID ${path}:`)
for (const e of errors) console.error(`  - ${e}`)
process.exit(1)
