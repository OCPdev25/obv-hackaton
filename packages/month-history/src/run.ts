/**
 * Journey harness: runs every journey check, validates that the machine
 * rubric (rubric.json) and the executed checks cover each other, prints a
 * per-journey table, and exits non-zero on any failure or coverage gap.
 * Deterministic: no clock reads, no randomness, no network.
 *
 * Usage:
 *   bun src/run.ts                          (from packages/month-history)
 *   pnpm --filter @journal/month-history journeys
 */
import { JOURNEY_CHECKS } from "./journeys.js"
import rubricJson from "../rubric.json"

interface RubricRow {
  readonly id: string
  readonly journey: string
  readonly criterion: string
  readonly measure: string
}
interface RubricFile {
  readonly version: string
  readonly checks: readonly RubricRow[]
}

const rubric = rubricJson as RubricFile

const results = JOURNEY_CHECKS.map((journeyCheck) => ({
  id: journeyCheck.id,
  journey: journeyCheck.journey,
  claim: journeyCheck.claim,
  ...journeyCheck.run(),
}))
const failed = results.filter((result) => !result.ok)

const rubricIds = new Set(rubric.checks.map((row) => row.id))
const executedIds = new Set(results.map((result) => result.id))
const uncovered = rubric.checks.filter((row) => !executedIds.has(row.id)).map((row) => row.id)
const unlisted = results.filter((result) => !rubricIds.has(result.id)).map((result) => result.id)

const journeys = [...new Set(results.map((result) => result.journey))]
console.log(`\nMonth-history journeys — rubric v${rubric.version}\n`)
for (const journey of journeys) {
  const rows = results.filter((result) => result.journey === journey)
  const passed = rows.filter((row) => row.ok).length
  console.log(`── ${journey} (${passed}/${rows.length})`)
  const idWidth = Math.max(...rows.map((row) => row.id.length))
  for (const row of rows) {
    console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.id.padEnd(idWidth)}  ${row.claim}`)
    if (!row.ok) console.log(`        ↳ ${row.detail}`)
  }
  console.log("")
}

if (failed.length === 0) {
  console.log(`All ${results.length} checks passed.`)
} else {
  console.log(`FAILURES: ${failed.length} of ${results.length} — ${failed.map((row) => row.id).join(", ")}`)
}
if (uncovered.length > 0) console.log(`RUBRIC ROWS WITHOUT EXECUTING CHECKS: ${uncovered.join(", ")}`)
if (unlisted.length > 0) console.log(`EXECUTED CHECKS MISSING FROM RUBRIC: ${unlisted.join(", ")}`)

if (failed.length > 0 || uncovered.length > 0 || unlisted.length > 0) process.exit(1)
