/**
 * Fixture (corpus) data types and loader.
 *
 * Fixtures are DATA: inputs plus expected outcomes, independent of any
 * candidate code. The runner interprets each `kind` with a fixed protocol;
 * everything expected of a candidate lives in the `expected` blocks.
 */
import type { EventCategory } from './adapter.ts'

export interface QuantityExpectation {
  readonly value: number
  readonly unit?: string
}

export interface EventExpectation {
  readonly category: EventCategory
  /** Exact absolute instant, Unix ms (see `toleranceMs`). */
  readonly occurredAt: number
  /** Expected quantity; when absent the event must NOT carry one (null is a contract violation). */
  readonly quantity?: QuantityExpectation
  /** Every needle must appear in `note` (case-insensitive, whitespace-collapsed). */
  readonly noteContains?: readonly string[]
  /** Allowed slack around `occurredAt` in ms. Default 0 (exact). */
  readonly toleranceMs?: number
}

export interface CaptureContext {
  /** "Now" for relative-time resolution, Unix ms. */
  readonly capturedAt: number
  readonly timezone: string
  readonly authorId: string
}

export interface MultiEventFixture {
  readonly kind: 'multi-event-narrative'
  readonly id: string
  readonly description: string
  readonly capture: CaptureContext
  readonly input: { readonly transcript: string }
  /** Events in transcript order; count and order are asserted exactly. */
  readonly expected: { readonly events: readonly EventExpectation[] }
}

export interface RelativeTimeCase {
  readonly id: string
  readonly captureId: string
  readonly transcript: string
  readonly capturedAt: number
  readonly timezone: string
  readonly expected: EventExpectation
}

export interface RelativeTimeFixture {
  readonly kind: 'relative-time'
  readonly id: string
  readonly description: string
  /** Resolution conventions the corpus holds candidates to, keyed by expression. */
  readonly conventions: Readonly<Record<string, string>>
  readonly authorId: string
  readonly cases: readonly RelativeTimeCase[]
}

export interface MalformedFixture {
  readonly kind: 'malformed-extraction'
  readonly id: string
  readonly description: string
  readonly capture: CaptureContext
  readonly input: { readonly captureId: string; readonly transcript: string }
  readonly expected: {
    readonly entryCreated: true
    readonly events: readonly []
    readonly rawPreserved: true
  }
}

export interface RetryDoubleSubmitFixture {
  readonly kind: 'retry-double-submit'
  readonly id: string
  readonly description: string
  readonly capture: CaptureContext
  readonly input: { readonly captureId: string; readonly transcript: string }
  readonly expected: { readonly events: readonly EventExpectation[] }
}

export interface RawFidelityCase {
  readonly id: string
  readonly captureId: string
  readonly transcript: string
  /** Whether the capture must be accepted (corpus always true: capture is never blocked). */
  readonly expectCreated: boolean
  readonly expectedEvents: readonly EventExpectation[]
}

export interface RawFidelityFixture {
  readonly kind: 'raw-fidelity'
  readonly id: string
  readonly description: string
  readonly capture: CaptureContext
  readonly cases: readonly RawFidelityCase[]
}

export interface ReloadInput {
  readonly captureId: string
  readonly transcript: string
  readonly expected: { readonly events: readonly EventExpectation[] }
}

export interface ReloadFixture {
  readonly kind: 'reload-persistence'
  readonly id: string
  readonly description: string
  readonly capture: CaptureContext
  readonly inputs: readonly ReloadInput[]
}

export type Fixture =
  | MultiEventFixture
  | RelativeTimeFixture
  | MalformedFixture
  | RetryDoubleSubmitFixture
  | RawFidelityFixture
  | ReloadFixture

const KNOWN_KINDS = [
  'multi-event-narrative',
  'relative-time',
  'malformed-extraction',
  'retry-double-submit',
  'raw-fidelity',
  'reload-persistence',
] as const

/** Shared with the manifest loader: extraction-accuracy registration enforces the same discipline. */
export function assertFixture(value: unknown, file: string): Fixture {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${file}: fixture must be a JSON object`)
  }
  const f = value as { kind?: unknown; id?: unknown }
  if (typeof f.id !== 'string' || f.id.length === 0) {
    throw new Error(`${file}: fixture is missing a non-empty "id"`)
  }
  if (typeof f.kind !== 'string' || !(KNOWN_KINDS as readonly string[]).includes(f.kind)) {
    throw new Error(`${file}: unknown fixture kind ${JSON.stringify(f.kind)} (known: ${KNOWN_KINDS.join(', ')})`)
  }
  return value as Fixture
}

/**
 * Load every *.json fixture from a directory, sorted by filename. Fails fast — never skips.
 *
 * `excludeAbsolutePaths` lists absolute file paths to skip (e.g. the fixture-area
 * manifest itself, which lives in the fixtures root and must never load as a fixture).
 */
export async function loadFixtures(
  fixturesDir: URL,
  options: { readonly excludeAbsolutePaths?: readonly string[] } = {},
): Promise<readonly Fixture[]> {
  const { readdir } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { join, resolve } = await import('node:path')

  const dir = fileURLToPath(fixturesDir)
  const excluded = new Set((options.excludeAbsolutePaths ?? []).map((p) => resolve(p)))
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.json') && !excluded.has(resolve(join(dir, f))))
    .sort()
  if (files.length === 0) {
    throw new Error(`no fixture files found in ${dir}`)
  }
  const fixtures: Fixture[] = []
  for (const file of files) {
    const path = join(dir, file)
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'))
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`${file}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`)
    }
    fixtures.push(assertFixture(parsed, file))
  }
  return fixtures
}
