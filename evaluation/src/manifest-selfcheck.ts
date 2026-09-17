/**
 * Registration self-check for the fixture-area manifest — `bun src/manifest-selfcheck.ts`.
 *
 * Proves the manifest contract the corpus run can't show on its own:
 * the seed manifest resolves to the extraction-accuracy corpus, and the
 * fail-fast rules (classes, bindings, paths, duplicates, empty areas,
 * per-class data discipline) reject every malformed registration.
 *
 * Exit 0 = all checks held; any failure throws (nonzero exit). Uses only
 * node built-ins — no runtime dependencies, runnable by bun or tsx.
 */
import { strict as assert } from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MANIFEST_FILENAME, loadManifest, resolveFixtureAreas } from './manifest.ts'

const SEED_CORPUS_FILES = [
  '01-multi-event-narrative.json',
  '02-relative-time-timezones.json',
  '03-malformed-extraction.json',
  '04-retry-double-submit.json',
  '05-raw-fidelity.json',
  '06-reload-persistence.json',
] as const

async function expectThrows(label: string, run: () => Promise<unknown>, messageIncludes: string): Promise<void> {
  try {
    await run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    assert.ok(
      message.includes(messageIncludes),
      `${label}: expected error containing ${JSON.stringify(messageIncludes)}, got: ${message}`,
    )
    return
  }
  assert.fail(`${label}: expected a throw, resolved instead`)
}

/** Write a manifest into a temp fixtures root and resolve it. */
async function resolveInTemp(root: string, manifest: unknown): Promise<Awaited<ReturnType<typeof resolveFixtureAreas>>> {
  const manifestPath = join(root, MANIFEST_FILENAME)
  await writeFile(manifestPath, JSON.stringify(manifest))
  return resolveFixtureAreas(pathToFileURL(manifestPath))
}

async function checkSeedManifest(): Promise<void> {
  const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url))
  const manifestUrl = pathToFileURL(join(fixturesDir, MANIFEST_FILENAME))
  const manifest = await loadManifest(manifestUrl)
  assert.equal(manifest.version, 1)
  // Committed manifest shape: the flat seed corpus plus the registered
  // scenario-and-authorization area consumed by the domain catch-up tests.
  assert.equal(manifest.areas.length, 2)
  assert.deepEqual(manifest.areas[0], { path: '.', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' })
  assert.deepEqual(manifest.areas[1], {
    path: 'agent-experience/catchup',
    fixtureClass: 'scenario-and-authorization',
    runnerBinding: 'bun-test-data',
  })

  const resolved = await resolveFixtureAreas(manifestUrl)
  assert.equal(resolved.areas.length, 2)
  const [area, scenarioArea] = resolved.areas
  assert.ok(area, 'seed manifest must resolve one area')
  assert.equal(area.spec.id, 'extraction-accuracy')
  // The six seed fixtures are present, sorted, and the manifest never lists itself.
  for (const name of SEED_CORPUS_FILES) {
    assert.ok(area.files.includes(name), `seed corpus must include ${name}`)
  }
  assert.ok(!area.files.includes(MANIFEST_FILENAME), 'manifest must never load as a fixture')
  assert.ok(area.files.every((f, i) => i === 0 || area.files[i - 1]! <= f), 'files must be sorted')
  // Scenario areas resolve as data-only: files listed for the consumer, never executed here.
  assert.ok(scenarioArea, 'registered scenario area must resolve')
  assert.equal(scenarioArea.spec.id, 'scenario-and-authorization')
  assert.deepEqual(scenarioArea.files, ['cases.json', 'grants.json', 'history.json'])
  console.log(
    `  ok  committed manifest — 2 areas (${area.files.length} corpus + ${scenarioArea.files.length} scenario files, manifest excluded)`,
  )
}

async function checkRejections(tempRoot: string): Promise<void> {
  // Unknown fixture class / unknown-or-illegal binding (closed registry + class↔binding legality).
  await expectThrows('unknown class', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: '.', fixtureClass: 'nope', runnerBinding: 'adapter-corpus' }],
    })
  , 'unknown fixtureClass')
  await expectThrows('illegal binding', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: '.', fixtureClass: 'extraction-accuracy', runnerBinding: 'bun-test-data' }],
    })
  , 'not legal for fixtureClass')
  await expectThrows('illegal pair, scenario bound to corpus runner', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: '.', fixtureClass: 'scenario-and-authorization', runnerBinding: 'adapter-corpus' }],
    })
  , 'not legal for fixtureClass')

  // Path rules: escape, absolute, trailing slash.
  await expectThrows('path escape', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: '../escape', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' }],
    })
  , 'must be "." or a relative')
  await expectThrows('absolute path', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: '/etc', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' }],
    })
  , 'must be "." or a relative')
  await expectThrows('trailing slash', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: 'sub/', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' }],
    })
  , 'must be "." or a relative')

  // Duplicates and shape.
  await expectThrows('duplicate path', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [
        { path: '.', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' },
        { path: '.', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' },
      ],
    })
  , 'duplicate area path')
  await expectThrows('bad version', () => resolveInTemp(tempRoot, { version: 2, areas: [] }), 'unsupported manifest version')
  await expectThrows('no corpus area', () => resolveInTemp(tempRoot, { version: 1, areas: [] }), 'registers no extraction-accuracy area')
  await expectThrows('missing area directory', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: 'does-not-exist', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' }],
    })
  , 'cannot enumerate area directory')
  console.log('  ok  rejections — classes, bindings, paths, duplicates, shape, missing areas')

  // Extraction discipline at registration: unknown `kind` fails registration, not the run.
  await mkdir(join(tempRoot, 'kinded'), { recursive: true })
  await writeFile(join(tempRoot, 'kinded', 'bad-kind.json'), JSON.stringify({ kind: 'nope', id: 'x' }))
  await expectThrows('unknown fixture kind', () =>
    resolveInTemp(tempRoot, {
      version: 1,
      areas: [{ path: 'kinded', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' }],
    })
  , 'unknown fixture kind')
  console.log('  ok  extraction-accuracy validator — kind discipline enforced at registration')

  // Scenario-and-authorization: JSON-loadable data is enough; no kind/schema discipline here.
  await mkdir(join(tempRoot, 'scenario-ok'), { recursive: true })
  await writeFile(join(tempRoot, 'scenario-ok', 'history.json'), JSON.stringify({ entries: [], grants: [], cases: [] }))
  await writeFile(join(tempRoot, 'scenario-ok', 'grants.json'), JSON.stringify(['any', 'loadable', 'json']))
  const scenarioManifestPath = join(tempRoot, 'scenario-manifest.json')
  await writeFile(
    scenarioManifestPath,
    JSON.stringify({
      version: 1,
      areas: [
        { path: 'kinded', fixtureClass: 'extraction-accuracy', runnerBinding: 'adapter-corpus' },
        { path: 'scenario-ok', fixtureClass: 'scenario-and-authorization', runnerBinding: 'bun-test-data' },
      ],
    }),
  )
  // kinded/ holds bad-kind.json — replace it with a valid extraction fixture so only the scenario shape is under test.
  await writeFile(
    join(tempRoot, 'kinded', 'bad-kind.json'),
    JSON.stringify({ kind: 'multi-event-narrative', id: 'ok' }),
  )
  const scenarioResolved = await resolveFixtureAreas(pathToFileURL(scenarioManifestPath))
  assert.equal(scenarioResolved.areas.length, 2)
  const [corpusArea, scenarioArea] = scenarioResolved.areas
  assert.ok(corpusArea && scenarioArea, 'both areas must resolve')
  assert.equal(scenarioArea.spec.id, 'scenario-and-authorization')
  assert.deepEqual(scenarioArea.files, ['grants.json', 'history.json'])
  console.log('  ok  scenario-and-authorization validator — JSON loadability only, distinct from extraction discipline')
}

async function main(): Promise<void> {
  console.log('Manifest registration self-check')
  await checkSeedManifest()
  const tempRoot = await mkdtemp(join(tmpdir(), 'eval-manifest-check-'))
  try {
    await checkRejections(tempRoot)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
  console.log('All manifest registration checks passed.')
}

await main()
