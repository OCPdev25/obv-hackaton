/**
 * Pure deterministic reducers for ambiguous-reference clarify and
 * correction-driven answer invalidation (spike slice 1).
 *
 * Contract source: art_gCDrtx4S §2.1 (envelope-only resolution table),
 * §2.2 (lineage watermark + citation-intersection invalidation), §4
 * (operation semantics). No Convex, no LLM, no clock, no randomness: every
 * function here is a pure function of its inputs, so the same inputs always
 * produce the same outputs and the fixtures are executable proofs.
 *
 * Runtime note (verified on effect@4.0.0-rc.115): there is no
 * Effect.catchAll and no bare Effect.catch on this pin — but no effect
 * composition is needed here at all; these are plain functions.
 */

import type {
  Answered,
  ClarifyOutcome,
  ClarifyQuestion,
  LineageWatermark,
  ReferenceEnvelope,
  RevisionLink,
  WatermarkMoved,
} from "./schema.js"

/** Hard rule (art_gCDrtx4S §2.2): a superseded answer is never served. */
const CLARIFY_QUESTION = "Which of these did you mean?"

/** Maximum clarification options (art_gCDrtx4S §4, open question 2 default). */
const MAX_OPTIONS = 4

/**
 * The records a revision marks as changed: the revised record plus its
 * containing entry, when present (art_gCDrtx4S §2.2 — "a revision of an
 * event marks both the event and its containing entry as revised, so
 * entry-level citations catch it too").
 */
export const changedRecordSet = (revision: RevisionLink): readonly string[] =>
  revision.containingEntryId === undefined
    ? [revision.targetRecordId]
    : [revision.targetRecordId, revision.containingEntryId]

/**
 * Monotonic watermark bump — exactly +1 per committed revision. No clock,
 * no randomness: the version is derived purely from the previous version.
 */
export const bumpWatermark = (watermark: LineageWatermark): LineageWatermark => ({
  householdId: watermark.householdId,
  version: watermark.version + 1,
})

/**
 * Citation-intersection invalidation (art_gCDrtx4S §2.2): an answer is
 * superseded iff its cited record ids intersect the revision's changed-record
 * set. Exhaustive because envelope citations name every record read.
 *
 * Only `current` answers flip: a superseded answer keeps the revision that
 * retired it (first pointer wins — never overwritten by later revisions).
 * Marked, never deleted: every answer in the input appears in the output.
 */
export const invalidateAnswers = (
  answers: readonly Answered[],
  revision: RevisionLink,
): { answers: Answered[]; supersededAnswerIds: string[] } => {
  const changed = changedRecordSet(revision)
  const supersededAnswerIds: string[] = []
  const next = answers.map((answer) => {
    if (answer.status !== "current") return answer
    const intersects = answer.citations.some((citation) => changed.includes(citation.recordId))
    if (!intersects) return answer
    supersededAnswerIds.push(answer.answerId)
    return { ...answer, status: "superseded" as const, supersededByRevisionId: revision.revisionId }
  })
  return { answers: next, supersededAnswerIds }
}

/**
 * Append-only answer/revision corpus for one household. Pure data — the
 * Convex persistence mapping is out of spike scope (no adapter here).
 */
export interface ReferenceStore {
  readonly householdId: string
  /** Current lineage version; bumped only by commitRevision. */
  readonly watermarkVersion: number
  /** Every answer ever persisted, current and superseded — never deleted. */
  readonly answers: readonly Answered[]
  /** Revision ids already applied — append-only, guards re-commit. */
  readonly committedRevisionIds: readonly string[]
}

/**
 * Commit a correction revision: bump the household lineage watermark and
 * supersede every answer whose citations intersect the changed-record set.
 * Idempotent on `revision.revisionId` — re-committing an already-applied
 * revision is a recorded no-op (no second bump, no re-invalidation).
 *
 * The only write in a correction chain happens here, by construction: the
 * clarify and answer operations below cannot produce a mutation.
 */
export const commitRevision = (
  store: ReferenceStore,
  revision: RevisionLink,
): { store: ReferenceStore; supersededAnswerIds: readonly string[] } => {
  if (store.committedRevisionIds.includes(revision.revisionId)) {
    return { store, supersededAnswerIds: [] }
  }
  const { answers, supersededAnswerIds } = invalidateAnswers(store.answers, revision)
  return {
    store: {
      householdId: store.householdId,
      watermarkVersion: bumpWatermark({
        householdId: store.householdId,
        version: store.watermarkVersion,
      }).version,
      answers,
      committedRevisionIds: [...store.committedRevisionIds, revision.revisionId],
    },
    supersededAnswerIds,
  }
}

/**
 * Serving gate (art_gCDrtx4S §4 "Serving rule"): a stored answer is served
 * only while `status = "current"`. A superseded answer is never served as
 * content — the caller gets a typed, retryable `watermark-moved` error and
 * recomputes at the current watermark. An absent answer is `undefined`
 * (truthful not-stored; the caller recomputes).
 *
 * A `current` answer stays servable even when the watermark has moved:
 * invalidation is citation-intersection, not version comparison — a revision
 * to unrelated records must not retire a truthful answer.
 */
export const serveAnswer = (
  answer: Answered | undefined,
  currentVersion: number,
): Answered | WatermarkMoved | undefined => {
  if (answer === undefined) return undefined
  if (answer.status === "superseded") {
    return {
      _tag: "watermark-moved",
      observedVersion: answer.readWatermark.version,
      currentVersion,
      retryable: true,
    }
  }
  return answer
}

// ---- clarify: envelope-only reference resolution (art_gCDrtx4S §2.1) ----

interface Candidate {
  readonly targetId: string
  readonly kind: "child" | "entry" | "event" | "message"
  readonly label: string
  readonly provenance: ClarifyQuestion["options"][number]["provenance"]
  /** The record a reference-derived candidate was derived from, if any. */
  readonly viaRecordId?: string
}

/**
 * Resolve the envelope's ambiguous reference, or bound it into a focused
 * clarification. Uses EXACTLY the proposal's three inputs — currentChild,
 * viewContext.selectedRecord, references[] — and nothing else: no corpus
 * statistics, no recency defaults, no cross-child inference.
 *
 * Outcome table (art_gCDrtx4S §2.1):
 * - 0 visible record candidates  → unresolved-reference / no-reference
 *   (or / target-not-visible when candidates existed but none were visible
 *   to the actor — the typed reason is the only existence disclosure)
 * - exactly 1                    → resolved binding, provenance recorded
 * - 2–4, all visible             → focused clarification: one question,
 *                                  options = the candidates, read-scoped
 * - more than the bound          → unresolved-reference / ambiguous
 * - candidate not visible / other child → target-not-visible /
 *   cross-child-blocked — never a softened read
 *
 * currentChild is a TIEBREAKER, never a candidate: "a child is not a
 * correction target" (§5 F-AX-UNRESOLVED-CORRECTION-001) — a child-only
 * envelope resolves nothing. When currentChild is asserted and child-kind
 * candidates exist, the candidates bound to that child win; if none match,
 * the reference points at another child → cross-child-blocked.
 */
export const computeClarify = (envelope: ReferenceEnvelope): ClarifyOutcome => {
  const references = envelope.references ?? []
  const visible = references.filter((reference) => reference.visibleToActor)
  const hadInvisible = visible.length < references.length

  const candidates: Candidate[] = []
  for (const reference of visible) {
    if (reference.relatedChildId !== undefined) {
      candidates.push({
        targetId: reference.relatedChildId,
        kind: "child",
        label: reference.snippet ?? reference.relatedChildId,
        provenance: reference.source,
        viaRecordId: reference.targetId,
      })
    } else {
      candidates.push({
        targetId: reference.targetId,
        kind: reference.kind,
        label: reference.snippet ?? reference.targetId,
        provenance: reference.source,
        viaRecordId: reference.targetId,
      })
    }
  }
  const viewContext = envelope.viewContext
  const selectedRecord = viewContext?.value.selectedRecord
  if (viewContext !== undefined && selectedRecord !== undefined) {
    candidates.push({
      targetId: selectedRecord.recordId,
      kind: selectedRecord.recordKind,
      label: selectedRecord.recordId,
      provenance: viewContext.source,
      viaRecordId: selectedRecord.recordId,
    })
  }

  const currentChildId = envelope.currentChild?.value.childId
  let working = candidates
  let tied = false
  if (currentChildId !== undefined) {
    const childCandidates = working.filter((candidate) => candidate.kind === "child")
    if (childCandidates.length > 0) {
      const matching = childCandidates.filter((candidate) => candidate.targetId === currentChildId)
      if (matching.length === 0) {
        return {
          _tag: "unresolved-reference",
          envelopeId: envelope.envelopeId,
          reason: "cross-child-blocked",
          retryable: false,
        }
      }
      working = matching
      tied = true
    }
  }

  if (working.length === 0) {
    return {
      _tag: "unresolved-reference",
      envelopeId: envelope.envelopeId,
      reason: hadInvisible ? "target-not-visible" : "no-reference",
      retryable: false,
    }
  }

  const only = working.length === 1 ? working[0] : undefined
  if (only !== undefined) {
    return {
      _tag: "resolved",
      envelopeId: envelope.envelopeId,
      targetId: only.targetId,
      kind: only.kind,
      provenance: tied ? (envelope.currentChild?.source ?? only.provenance) : only.provenance,
      basis: tied
        ? `bound by ${envelope.currentChild?.source ?? "currentChild"} currentChild via reference ${only.viaRecordId ?? only.targetId}`
        : "sole visible candidate in envelope context",
    }
  }

  if (working.length > MAX_OPTIONS) {
    return {
      _tag: "unresolved-reference",
      envelopeId: envelope.envelopeId,
      reason: "ambiguous",
      detail: `reference bound exceeded: ${working.length} candidates, maximum ${MAX_OPTIONS}`,
      retryable: false,
    }
  }

  const seen = new Set<string>()
  const options = working
    .map((candidate) => ({
      targetId: candidate.targetId,
      kind: candidate.kind,
      label: candidate.label,
      provenance: candidate.provenance,
    }))
    .filter((option) => {
      const key = `${option.kind}:${option.targetId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const ambiguousReferenceIds = [...new Set(working.flatMap((c) => (c.viaRecordId ? [c.viaRecordId] : [])))]
  const question: ClarifyQuestion = {
    _tag: "clarify-question",
    envelopeId: envelope.envelopeId,
    question: CLARIFY_QUESTION,
    options,
    ambiguousReferenceIds,
  }
  return question
}
