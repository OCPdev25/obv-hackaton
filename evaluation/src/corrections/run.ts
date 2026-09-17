#!/usr/bin/env bun
/**
 * CLI for the conversational correction challenge corpus.
 *
 *   bun src/corrections/run.ts
 *   bun src/corrections/run.ts --adapter=./src/corrections/example/broken-adapter.ts --expect-failure
 *
 * The adapter module must export `createCorrectionAdapter(env)` (env-dependent,
 * unlike the capture corpus's no-arg `createAdapter`). Exit codes match the
 * existing capture-corpus CLI: 0 on success (or on expected failure), 1 otherwise.
 */
import process from 'node:process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CorrectionAdapterFactory } from './adapter.ts'
import { createCorrectionAdapter as referenceFactory } from './example/example-adapter.ts'
import { loadCorrectionFixtures } from './fixtures.ts'
import { runCorrectionCorpus } from './runner.ts'

async function loadFactory(modulePath: string): Promise<CorrectionAdapterFactory> {
  const resolved = pathToFileURL(path.resolve(process.cwd(), modulePath)).href
  const mod = (await import(resolved)) as Record<string, unknown>
  const factory = mod['createCorrectionAdapter']
  if (typeof factory !== 'function') {
    throw new Error(`adapter module ${modulePath} must export createCorrectionAdapter(env)`)
  }
  return factory as CorrectionAdapterFactory
}

const args = process.argv.slice(2)
const adapterArg = args.find((a) => a.startsWith('--adapter='))?.slice('--adapter='.length)
const expectFailure = args.includes('--expect-failure')

const correctionsDir = new URL('../../corrections/', import.meta.url)
const { env, cases } = loadCorrectionFixtures(correctionsDir)
const factory = adapterArg !== undefined ? await loadFactory(adapterArg) : referenceFactory
const summary = await runCorrectionCorpus(factory, env, cases)

for (const r of summary.results) {
  const mark = r.ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${r.caseId}`)
  for (const f of r.failures) console.log(`       · ${f}`)
}
console.log(`\n${summary.passed}/${summary.results.length} cases passed for adapter "${summary.adapterName}"`)
process.exitCode = summary.ok === !expectFailure ? 0 : 1
