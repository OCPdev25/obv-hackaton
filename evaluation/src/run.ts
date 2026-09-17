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
import { loadFixtures, type Fixture } from './fixtures.ts'
import { resolveFixtureAreas, type RegisteredArea } from './manifest.ts'
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

  // Namespace-aware registration: every fixture area comes from the manifest,
  // validated fail-fast before anything executes. Extraction-accuracy areas
  // feed the corpus run; scenario-and-authorization areas are validated here
  // but executed by their consuming bun test suites.
  const resolved = await resolveFixtureAreas(new URL('../fixtures/manifest.json', import.meta.url))
  const corpusFixtures: Fixture[] = []
  const scenarioAreas: RegisteredArea[] = []
  for (const area of resolved.areas) {
    if (area.entry.fixtureClass === 'extraction-accuracy') {
      corpusFixtures.push(...(await loadFixtures(area.dirUrl, { excludeAbsolutePaths: [resolved.manifestPath] })))
    } else if (area.entry.fixtureClass === 'scenario-and-authorization') {
      scenarioAreas.push(area)
    } else {
      // Unreachable while FIXTURE_CLASSES is closed — a new class must add CLI behavior here.
      throw new Error(`no CLI behavior registered for fixture class ${JSON.stringify(area.entry.fixtureClass)} (area ${JSON.stringify(area.entry.path)})`)
    }
  }

  const summary = await runCorpus(adapter, corpusFixtures)

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

  // Registered non-corpus areas surface here so registration is visible in
  // every run. Nothing is printed while none are registered, keeping the
  // extraction-only output byte-identical to the pre-manifest harness.
  if (scenarioAreas.length > 0) {
    console.log('')
    console.log('Registered scenario-and-authorization areas (validated; executed by bun test suites, not this run):')
    for (const area of scenarioAreas) {
      console.log(`  - ${area.entry.path}  (${area.files.length} file(s))`)
    }
  }

  if (expectFailure) return summary.ok ? 1 : 0 // exit 0 iff the harness caught at least one failure
  return summary.ok ? 0 : 1
}

process.exitCode = await main()
