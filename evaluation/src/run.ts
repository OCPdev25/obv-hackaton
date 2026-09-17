/**
 * CLI entry: `bun src/run.ts [--adapter=<path>] [--expect-failure]`
 *
 *  --adapter=<path>   Module (relative to the evaluation package root or
 *                     absolute) exporting `createAdapter(): CandidateAdapter`.
 *                     Defaults to the worked example adapter.
 *  --expect-failure   Invert the exit code: exit 0 iff the run found failures
 *                     (used by the broken-adapter negative control).
 */
import type { CandidateAdapter } from './adapter.ts'
import { loadFixtures } from './fixtures.ts'
import { runCorpus } from './runner.ts'
import { createAdapter as createExampleAdapter } from './example/example-adapter.ts'

async function loadAdapter(adapterArg: string | undefined): Promise<CandidateAdapter> {
  if (adapterArg === undefined) return createExampleAdapter()

  const { pathToFileURL, fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const modulePath = pathToFileURL(resolve(packageRoot, adapterArg)).href
  const mod = (await import(modulePath)) as { createAdapter?: unknown }
  if (typeof mod.createAdapter !== 'function') {
    throw new Error(`adapter module ${adapterArg} must export a named factory: createAdapter(): CandidateAdapter`)
  }
  const adapter = (mod.createAdapter as () => CandidateAdapter)()
  if (typeof adapter?.name !== 'string' || adapter.name.length === 0) {
    throw new Error(`adapter factory in ${adapterArg} returned an object without a non-empty "name"`)
  }
  return adapter
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const adapterArg = args.find((a) => a.startsWith('--adapter='))?.slice('--adapter='.length)
  const expectFailure = args.includes('--expect-failure')

  const adapter = await loadAdapter(adapterArg)
  const fixtures = await loadFixtures(new URL('../fixtures/', import.meta.url))
  const summary = await runCorpus(adapter, fixtures)

  console.log(`\nAcceptance corpus — adapter: ${summary.adapterName}`)
  console.log('='.repeat(72))
  for (const result of summary.results) {
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.fixtureId}${result.note ? `  (${result.note})` : ''}`)
    for (const failure of result.failures) {
      console.log(`         - ${failure}`)
    }
  }
  console.log('='.repeat(72))
  console.log(`Summary: ${summary.passed}/${summary.results.length} fixtures passed`)

  if (expectFailure) return summary.ok ? 1 : 0 // exit 0 iff the harness caught at least one failure
  return summary.ok ? 0 : 1
}

process.exitCode = await main()
