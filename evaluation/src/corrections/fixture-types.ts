/**
 * Fixture shapes + controlled vocabularies for the conversational correction
 * challenge corpus (evaluation/corrections). Data-only module: no I/O.
 */
import type { HouseholdEnv, ResponseClass } from './adapter.ts'

export interface SeedEventFixture {
  category: string
  occurredAt: number
  note?: string
  quantity?: { value: number; unit: string }
}

export interface SetupTurnFixture {
  turnId: string
  captureId?: string
  speakerId: string
  capturedAt: number
  text: string
  seedEvents?: SeedEventFixture[]
}

export interface EventExpectationFixture {
  category: string
  occurredAt: number
  toleranceMs?: number
  /** Absent: the event must NOT carry a quantity (zero-care representation check). */
  quantity?: { value: number; unit: string } | null
  noteContains?: string[]
  noteNotContains?: string[]
}

export interface EntryChangeFixture {
  ofCaptureId: string
  childId?: string
  status?: string
  authorIdMustRemain?: string
  transcriptUnchanged?: boolean
  events?: EventExpectationFixture[]
}

export interface AppendedRevisionFixture {
  ofCaptureId: string
  kind: string
  authorId: string
  count?: number
}

export interface NewEntryExpectationFixture {
  childId: string
  authorId: string
  status: string
  events: EventExpectationFixture[]
  revisionKinds?: string[]
}

export interface StateDeltaFixture {
  entryCountDelta?: number
  entryChanges?: EntryChangeFixture[]
  newEntries?: NewEntryExpectationFixture[]
  appendedRevisions?: AppendedRevisionFixture[]
}

export interface TurnExpectationFixture {
  responseClass: string
  stateDelta?: 'none' | StateDeltaFixture
}

export interface ChallengeTurnFixture {
  turnId: string
  speakerId: string
  capturedAt: number
  text: string
  correctionId?: string
  expect: TurnExpectationFixture
}

export interface ReplayFixture {
  turnIndex: number
  note?: string
  expectResponseClass?: string
}

export interface BaselineEntryCheckFixture {
  ofCaptureId: string
  status?: string
  events?: EventExpectationFixture[]
}

export interface FinalEntryCheckFixture {
  ofCaptureId: string
  childId: string
  authorId: string
  status: string
  transcriptByteEquals: string
  events: EventExpectationFixture[]
  revisionKinds: string[]
  lastRevisionAuthorId?: string
}

export interface FinalExpectationFixture {
  entryCount: number
  entries?: FinalEntryCheckFixture[]
  newEntries?: NewEntryExpectationFixture[]
}

export interface CorrectionCaseFixture {
  id: string
  category: string
  description: string
  exercises: string[]
  setup: {
    turns: SetupTurnFixture[]
    publish?: string[]
    baseline: {
      entryCount: number
      entries?: BaselineEntryCheckFixture[]
      revisionKinds?: Record<string, string[]>
    }
  }
  turns: ChallengeTurnFixture[]
  replay?: ReplayFixture
  final: FinalExpectationFixture
  forbidden: string[]
}

export interface CorrectionCorpus {
  env: HouseholdEnv
  cases: CorrectionCaseFixture[]
}

export const CASE_CATEGORIES = [
  'time-correction',
  'wrong-child',
  'wrong-prior-event',
  'multi-author',
  'negation',
  'repeated-corrections-and-undo',
] as const

export const RESPONSE_CLASSES: readonly ResponseClass[] = ['applied', 'clarification', 'rejected']

/** Controlled vocabulary of prohibited behaviors (documentation + validation). */
export const FORBIDDEN_OPS = [
  'entry.delete',
  'entry.duplicate_without_supersession',
  'raw.mutate',
  'raw.delete',
  'event.duplicate_without_supersession',
  'event.create_fabricated',
  'event.retarget_without_lineage',
  'revision.attribution_rewrite',
  'revision.wrong_target',
  'lineage.truncate',
  'write.without_grant',
  'write.suppressed_when_due',
  'stale.clobber',
  'idempotent.duplicate_revision',
  'publication.change_via_correction',
  'audience.change_via_correction',
  'zero_care.assert_without_capture',
  'quantity.zero_duration_sleep_representation',
] as const
