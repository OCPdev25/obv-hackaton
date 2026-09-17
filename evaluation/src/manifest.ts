/**
 * Namespace-aware fixture-area registration (the manifest).
 *
 * The corpus root (evaluation/fixtures/) is flat, but fixture areas may also
 * live in sub-namespaces (e.g. agent-experience/catchup/). The manifest file
 * — evaluation/fixtures/manifest.json — is the single registration point:
 * it lists every fixture AREA with its class and runner binding, and the
 * harness discovers, validates, and dispatches areas from it. Registration is
 * fail-fast: an area that does not exist, is empty, or violates its class's
 * data discipline fails the run before any fixture executes. Nothing is ever
 * silently skipped.
 *
 * A fixture CLASS pins two things (both stated in FIXTURE_CLASSES):
 * - validator semantics — what the harness checks about the area's data;
 * - runner semantics — who executes the data and whether results count
 *   toward the harness pass/fail summary.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertFixture } from './fixtures.ts'

/** Name of the manifest file inside the fixtures root. */
export const MANIFEST_FILENAME = 'manifest.json'

/** Semantic class of a fixture area: what its data pins and who validates it. */
export type FixtureClass = 'extraction-accuracy' | 'scenario-and-authorization'

/** How a registered area binds to a runner. */
export type RunnerBinding = 'adapter-corpus' | 'bun-test-data'

export interface FixtureAreaEntry {
  /**
   * Directory of the area, relative to the directory CONTAINING the manifest
   * file. "." is that directory itself (the flat root corpus).
   */
  readonly path: string
  readonly fixtureClass: FixtureClass
  readonly runnerBinding: RunnerBinding
}

export interface FixtureAreaManifest {
  readonly version: 1
  readonly areas: readonly FixtureAreaEntry[]
}

/** One registered area after fail-fast discovery and validation. */
export interface RegisteredArea {
  readonly entry: FixtureAreaEntry
  /** Absolute filesystem path of the area directory. */
  readonly dir: string
  /** URL form of `dir` (trailing slash) — directly usable by `loadFixtures`. */
  readonly dirUrl: URL
  /**
   * Immediate *.json filenames of the area, sorted. The manifest file itself
   * is never included, and enumeration is non-recursive: an area owns exactly
   * its own directory.
   */
  readonly files: readonly string[]
  /** The resolved class spec (validator + runner semantics for this area). */
  readonly spec: FixtureClassSpec
}

export interface ResolvedManifest {
  /** Absolute path of the manifest file (excluded from every area file list). */
  readonly manifestPath: string
  /** Areas in manifest order — the harness processes them in this order. */
  readonly areas: readonly RegisteredArea[]
}

/**
 * A fixture class's contract: the only runner binding legal for it, a
 * one-line statement of its validator/runner semantics, and a fail-fast
 * structural validator over the area's files.
 */
export interface FixtureClassSpec {
  readonly id: FixtureClass
  readonly runnerBinding: RunnerBinding
  readonly summary: string
  /** Throws (with file context) if any file violates the class's data rules. */
  readonly validateFiles: (dir: string, files: readonly string[]) => Promise<void>
}

async function parseJsonFile(dir: string, file: string): Promise<unknown> {
  const raw = await readFile(join(dir, file), 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${file}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Extraction accuracy: full corpus discipline (known `kind`, non-empty `id`) enforced at registration. */
async function validateExtractionAccuracyFiles(dir: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    assertFixture(await parseJsonFile(dir, file), file)
  }
}

/**
 * Scenario-and-authorization: the harness validates JSON loadability only.
 * Semantic validation (history/grants/case schemas, expected outcomes) and
 * execution belong to the consuming bun test suites — registration means
 * "loadable and present", never "executed here".
 */
async function validateScenarioAndAuthorizationFiles(dir: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    await parseJsonFile(dir, file)
  }
}

/** The closed registry of fixture classes. Adding a class = adding an entry here + CLI behavior in run.ts. */
export const FIXTURE_CLASSES: Readonly<Record<FixtureClass, FixtureClassSpec>> = {
  'extraction-accuracy': {
    id: 'extraction-accuracy',
    runnerBinding: 'adapter-corpus',
    summary:
      'Transcript→events expectations executed by the candidate-agnostic corpus runner (src/runner.ts) ' +
      'against a CandidateAdapter; results count toward pass/fail. Data discipline per file: known `kind` + non-empty `id`.',
    validateFiles: validateExtractionAccuracyFiles,
  },
  'scenario-and-authorization': {
    id: 'scenario-and-authorization',
    runnerBinding: 'bun-test-data',
    summary:
      'Scenario setup, grants, and expected-outcome data consumed directly by bun test suites ' +
      '(e.g. packages/domain/test/catchup.test.ts). This harness validates JSON loadability only; ' +
      'semantic validation and execution live with the consuming test suite.',
    validateFiles: validateScenarioAndAuthorizationFiles,
  },
}

const AREA_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAreaEntry(value: unknown, index: number): FixtureAreaEntry {
  const where = `${MANIFEST_FILENAME}: areas[${index}]`
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`)
  }
  const relPath = value['path']
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error(`${where} is missing a non-empty string "path"`)
  }
  if (relPath !== '.' && !AREA_PATH_PATTERN.test(relPath)) {
    throw new Error(
      `${where}: path ${JSON.stringify(relPath)} must be "." or a relative slash-separated directory ` +
        `of [A-Za-z0-9._-] segments (no "..", no absolute paths, no trailing slash)`,
    )
  }
  const className = value['fixtureClass']
  if (typeof className !== 'string' || !(className in FIXTURE_CLASSES)) {
    throw new Error(
      `${where}: unknown fixtureClass ${JSON.stringify(className)} (known: ${Object.keys(FIXTURE_CLASSES).join(', ')})`,
    )
  }
  const spec = FIXTURE_CLASSES[className as FixtureClass]
  const binding = value['runnerBinding']
  if (typeof binding !== 'string' || binding !== spec.runnerBinding) {
    throw new Error(
      `${where}: runnerBinding ${JSON.stringify(binding)} is not legal for fixtureClass "${className}" — ` +
        `expected ${JSON.stringify(spec.runnerBinding)}`,
    )
  }
  return { path: relPath, fixtureClass: className as FixtureClass, runnerBinding: binding as RunnerBinding }
}

/** Resolve and contain an area path against the fixtures root. Defense-in-depth behind the path regex. */
function resolveAreaDir(rootDir: string, relPath: string, where: string): string {
  const dir = relPath === '.' ? rootDir : resolve(rootDir, relPath)
  if (dir !== rootDir && !dir.startsWith(rootDir + sep)) {
    throw new Error(`${where}: area path ${JSON.stringify(relPath)} resolves outside the fixtures root`)
  }
  return dir
}

/** Parse and validate the manifest file itself (shape, classes, bindings, dedupe, ≥1 corpus area). */
export async function loadManifest(manifestUrl: URL): Promise<FixtureAreaManifest> {
  const manifestPath = fileURLToPath(manifestUrl)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (err) {
    throw new Error(`${MANIFEST_FILENAME}: cannot read/parse manifest — ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${MANIFEST_FILENAME}: manifest must be a JSON object`)
  }
  if (parsed['version'] !== 1) {
    throw new Error(`${MANIFEST_FILENAME}: unsupported manifest version ${JSON.stringify(parsed['version'])} — expected 1`)
  }
  const areasRaw = parsed['areas']
  if (!Array.isArray(areasRaw)) {
    throw new Error(`${MANIFEST_FILENAME}: "areas" must be an array`)
  }
  const areas = areasRaw.map((value, index) => parseAreaEntry(value, index))

  const seen = new Set<string>()
  for (const area of areas) {
    if (seen.has(area.path)) {
      throw new Error(`${MANIFEST_FILENAME}: duplicate area path ${JSON.stringify(area.path)}`)
    }
    seen.add(area.path)
  }
  if (!areas.some((a) => a.fixtureClass === 'extraction-accuracy')) {
    throw new Error(`${MANIFEST_FILENAME}: manifest registers no extraction-accuracy area — the corpus run would be empty`)
  }
  return { version: 1, areas }
}

/**
 * Load the manifest and discover every registered area, fail-fast: each area
 * must exist, own at least one *.json file, and pass its class validator
 * before this resolves. Returns areas in manifest order.
 */
export async function resolveFixtureAreas(manifestUrl: URL): Promise<ResolvedManifest> {
  const manifestPath = fileURLToPath(manifestUrl)
  const manifest = await loadManifest(manifestUrl)
  const rootDir = resolve(dirname(manifestPath))

  const areas: RegisteredArea[] = []
  for (const entry of manifest.areas) {
    const where = `${MANIFEST_FILENAME}: area ${JSON.stringify(entry.path)}`
    const dir = resolveAreaDir(rootDir, entry.path, where)
    const spec = FIXTURE_CLASSES[entry.fixtureClass]
    let names: readonly string[]
    try {
      names = await readdir(dir)
    } catch (err) {
      throw new Error(`${where}: cannot enumerate area directory ${dir} — ${err instanceof Error ? err.message : String(err)}`)
    }
    const files = names
      .filter((f) => f.endsWith('.json') && join(dir, f) !== manifestPath)
      .sort()
    if (files.length === 0) {
      throw new Error(`${where}: no fixture files found in ${dir}`)
    }
    await spec.validateFiles(dir, files)
    areas.push({ entry, dir, dirUrl: pathToFileURL(`${dir}/`), files, spec })
  }
  return { manifestPath, areas }
}
