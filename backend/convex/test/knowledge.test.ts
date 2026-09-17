/**
 * Validator-level tests for the knowledge functions (backend/convex).
 *
 * There is no local Convex runtime harness (N1 observation, still open), so
 * the evidence standard is the PR #24 precedent: exercise the exact
 * contracts and pure decision logic the handlers use — input decoding, row
 * composition, supersession eligibility, publication-dimension visibility —
 * plus the PR #16 synthetic fixtures as semantic ground truth. Handler
 * wiring is proven by strict typechecking against the generated API.
 *
 * Fixtures are treated as ground truth, not re-derived: the PR #16 fixtures
 * in packages/domain/test/fixtures/knowledge/ must decode and pass the
 * domain invariants unchanged, and fixture 06's negative cases must fail at
 * their stated stage (decode vs invariants) through the function pipeline.
 */
import { describe, expect, it } from "bun:test"
import { Schema } from "effect"

import { KnowledgeDocument, KnowledgeSchema, assertKnowledgeInvariants, KnowledgeShapeError } from "@journal/domain"

import {
  CreateKnowledgeItemInput,
  ListKnowledgeInput,
  MAX_KNOWLEDGE_PAGE,
  SupersedeKnowledgeItemInput,
  buildKnowledgeItemRow,
  checkSupersession,
  isCurrentKnowledgeItem,
  isVisibleKnowledgeItem,
} from "../convex/knowledgeInput"

import settlingFixture from "../../../packages/domain/test/fixtures/knowledge/01-settling-preferences.json"
import changingFixture from "../../../packages/domain/test/fixtures/knowledge/04-changing-preferences.json"
import invalidFixture from "../../../packages/domain/test/fixtures/knowledge/06-invalid-items.json"

// --- World: fixture-derived ground truth ---------------------------------------------------

const decodeKnowledge = Schema.decodeUnknownSync(KnowledgeSchema)
const decodeKnowledgeDoc = Schema.decodeUnknownSync(KnowledgeDocument)

const NOW = 1789700000000

/** Content fields lifted from the fixture world (conflicting bedtime reports, fixture 05). */
const baseCreate = {
  householdId: "synthetic-household-0001",
  childId: "synthetic-child-0001",
  kind: "settling",
  topic: "bedtime",
  statement: "Bedtime is 7:30 pm on school nights and she is asleep within minutes.",
  statedBy: "caregiver-mom",
  recordedBy: "caregiver-mom",
  provenanceKind: "caregiver-stated",
  confidence: 0.8,
  sourceType: "entry",
  sourceEntryId: "synthetic-entry-0005",
  sourceSpan: { start: 0, end: 66 },
  sourceQuote: "7:30 sharp on school nights and she's out within minutes.",
}

/** A current fixture item promoted to a stored document (system fields added). */
const storedCurrentDoc = (item: unknown, id: string): typeof KnowledgeDocument["Type"] =>
  decodeKnowledgeDoc({ ...(item as object), _id: id, _creationTime: 0 })

// --- Ground truth: the PR #16 fixtures stay valid -------------------------------------------

describe("Fixture ground truth (PR #16 corpus)", () => {
  it("settling-preferences and changing-preferences items decode and pass the domain invariants", () => {
    for (const fixture of [settlingFixture, changingFixture]) {
      const items = (fixture as { items: unknown[] }).items
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        const decoded = decodeKnowledge(item)
        assertKnowledgeInvariants(decoded)
      }
    }
  })

  it("fixture 06's negative cases fail at their stated stage", () => {
    for (const negative of invalidFixture.cases) {
      if (negative.rejectAt === "decode") {
        expect(() => decodeKnowledge(negative.item)).toThrow()
      } else {
        // Shape-valid but contract-invalid: decode passes, invariants throw.
        // Document-shaped cases (e.g. self-supersession) must decode through
        // the document contract so system fields like `_id` are present for
        // the invariants; the base schema strips them.
        const decoded = "_id" in negative.item ? decodeKnowledgeDoc(negative.item) : decodeKnowledge(negative.item)
        expect(() => assertKnowledgeInvariants(decoded)).toThrow(KnowledgeShapeError)
      }
    }
  })
})

// --- Create pipeline: decode -> row composition ----------------------------------------------

describe("CreateKnowledgeItemInput decode", () => {
  it("accepts content for every kind (settling, routine, quote, preference)", () => {
    const payloads = [
      baseCreate,
      { ...baseCreate, kind: "routine", topic: "bedtime-routine", statement: "Fixed order, every night.", steps: ["warm bath", "pajamas", "books", "lights out"] },
      { ...baseCreate, kind: "quote", topic: "sayings", statement: "Something funny at breakfast.", quoteText: "Where does the sun sleep?", spokenBy: "child" },
      { ...baseCreate, kind: "preference", topic: "milk-cup", statement: "Drinks from the open cup at meals now." },
    ]
    for (const payload of payloads) {
      const args = Schema.decodeUnknownSync(CreateKnowledgeItemInput)(payload)
      // Composition must satisfy the full family-knowledge contract.
      const row = buildKnowledgeItemRow(args, NOW)
      assertKnowledgeInvariants(row)
    }
  })

  it("rejects shape violations at decode (medical kind, confidence out of range, empty statement)", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateKnowledgeItemInput)({ ...baseCreate, kind: "medical" }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CreateKnowledgeItemInput)({ ...baseCreate, confidence: 1.5 }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CreateKnowledgeItemInput)({ ...baseCreate, statement: "" }),
    ).toThrow()
  })

  it("rejects contract violations at row composition (topic slug, quote structure, provenance, source)", () => {
    // Decode passes (shape-valid); the cross-field invariants must reject.
    const cases = [
      { ...baseCreate, topic: "Bedtime!!" }, // not a lowercase kebab-case slug
      { ...baseCreate, kind: "quote", topic: "sayings", quoteText: undefined }, // quote without quoteText
      { ...baseCreate, recordedBy: "extraction-model", provenanceKind: "caregiver-confirmed", confidence: 1 }, // model claims confirmed certainty
      { ...baseCreate, sourceEntryId: undefined }, // entry source without sourceEntryId
      { ...baseCreate, steps: ["books"] }, // steps only valid for kind "routine"
    ]
    for (const payload of cases) {
      const args = Schema.decodeUnknownSync(CreateKnowledgeItemInput)(payload)
      expect(() => buildKnowledgeItemRow(args, NOW)).toThrow(KnowledgeShapeError)
    }
  })

  it("sets lifecycle server-side: status current, visibility draft, validFrom defaulting to now", () => {
    const row = buildKnowledgeItemRow(Schema.decodeUnknownSync(CreateKnowledgeItemInput)(baseCreate), NOW)
    expect(row.status).toBe("current")
    expect(row.visibility).toBe("draft")
    expect(row.validFrom).toBe(NOW)
    expect(row.createdAt).toBe(NOW)

    const backdated = buildKnowledgeItemRow(
      Schema.decodeUnknownSync(CreateKnowledgeItemInput)({ ...baseCreate, validFrom: 123 }),
      NOW,
    )
    expect(backdated.validFrom).toBe(123)
  })
})

// --- Supersede pipeline: eligibility decisions -----------------------------------------------

describe("checkSupersession", () => {
  const currentTarget = storedCurrentDoc(
    (changingFixture as { items: unknown[] }).items[1],
    "synthetic-knowledge-0402",
  )
  const supersededTarget = storedCurrentDoc(
    (changingFixture as { items: unknown[] }).items[0],
    "synthetic-knowledge-0401",
  )

  it("eligibility for a current target with a valid window", () => {
    expect(
      checkSupersession(currentTarget, {
        householdId: currentTarget.householdId,
        childId: currentTarget.childId,
        validFrom: currentTarget.validFrom + 1000,
      }),
    ).toEqual({ outcome: "eligible" })
  })

  it("rejects a superseded target (append-only chains — no forks)", () => {
    expect(
      checkSupersession(supersededTarget, {
        householdId: supersededTarget.householdId,
        childId: supersededTarget.childId,
        validFrom: NOW,
      }),
    ).toMatchObject({ outcome: "rejected", code: "SUPERSESSION_TARGET_NOT_CURRENT" })
  })

  it("rejects cross-household and cross-child supersession", () => {
    expect(
      checkSupersession(currentTarget, {
        householdId: "synthetic-household-9999",
        childId: currentTarget.childId,
        validFrom: NOW,
      }),
    ).toMatchObject({ outcome: "rejected", code: "SUPERSESSION_HOUSEHOLD_MISMATCH" })
    expect(
      checkSupersession(currentTarget, {
        householdId: currentTarget.householdId,
        childId: "synthetic-child-9999",
        validFrom: NOW,
      }),
    ).toMatchObject({ outcome: "rejected", code: "SUPERSESSION_CHILD_MISMATCH" })
  })

  it("rejects a replacement validFrom before the target's validFrom (validUntil would precede validFrom)", () => {
    expect(
      checkSupersession(currentTarget, {
        householdId: currentTarget.householdId,
        childId: currentTarget.childId,
        validFrom: currentTarget.validFrom - 1,
      }),
    ).toMatchObject({ outcome: "rejected", code: "SUPERSESSION_WINDOW_INVALID" })
  })

  it("the closing patch the handler performs satisfies the domain invariants (chain continuity)", () => {
    const validFrom = currentTarget.validFrom + 1000
    const closed = { ...currentTarget, status: "superseded" as const, validUntil: validFrom }
    assertKnowledgeInvariants(closed)
    expect(closed.validUntil).toBe(validFrom)
    // And the same patch with an invalid window is caught by the domain —
    // the handler's defense-in-depth assertion fires before any write.
    expect(() =>
      assertKnowledgeInvariants({ ...currentTarget, status: "superseded", validUntil: currentTarget.validFrom - 1 }),
    ).toThrow(KnowledgeShapeError)
  })
})

// --- Supersede input: the forward edge is required --------------------------------------------

describe("SupersedeKnowledgeItemInput decode", () => {
  it("requires the supersedes target", () => {
    expect(() => Schema.decodeUnknownSync(SupersedeKnowledgeItemInput)(baseCreate)).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(SupersedeKnowledgeItemInput)({ ...baseCreate, supersedes: "synthetic-knowledge-0402" }),
    ).not.toThrow()
  })
})

// --- Bounded read input: explicit, capped limit ------------------------------------------------

describe("ListKnowledgeInput bounds", () => {
  const listArgs = { householdId: "synthetic-household-0001", childId: "synthetic-child-0001" }

  it("requires the limit — an unbounded read has no caller", () => {
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)(listArgs)).toThrow()
  })

  it("accepts limit 1..MAX and rejects 0, MAX+1, and non-integers", () => {
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)({ ...listArgs, limit: 1 })).not.toThrow()
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)({ ...listArgs, limit: MAX_KNOWLEDGE_PAGE })).not.toThrow()
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)({ ...listArgs, limit: 0 })).toThrow()
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)({ ...listArgs, limit: MAX_KNOWLEDGE_PAGE + 1 })).toThrow()
    expect(() => Schema.decodeUnknownSync(ListKnowledgeInput)({ ...listArgs, limit: 1.5 })).toThrow()
  })
})

// --- Read-model predicates ----------------------------------------------------------------------

describe("Read-model predicates", () => {
  // Stored rows in production are buildKnowledgeItemRow outputs with system
  // fields attached — build the mock the same way so every lifecycle field
  // is present and valid before overrides are applied.
  const storedRow = (overrides: Record<string, unknown>) => {
    const row = buildKnowledgeItemRow(Schema.decodeUnknownSync(CreateKnowledgeItemInput)(baseCreate), NOW)
    return decodeKnowledgeDoc({ ...row, ...overrides, _id: "synthetic-knowledge-x", _creationTime: 0 })
  }

  it("current-items predicate: superseded rows are excluded from current by default", () => {
    expect(isCurrentKnowledgeItem(storedRow({}))).toBe(true)
    expect(isCurrentKnowledgeItem(storedRow({ status: "superseded", validUntil: NOW }))).toBe(false)
  })

  it("publication dimension: published is household-audience; drafts are recorder-only; no viewer sees no drafts", () => {
    const published = storedRow({ visibility: "published" })
    const draft = storedRow({ visibility: "draft" })

    expect(isVisibleKnowledgeItem(published, undefined)).toBe(true)
    expect(isVisibleKnowledgeItem(published, "caregiver-dad")).toBe(true)
    expect(isVisibleKnowledgeItem(draft, undefined)).toBe(false)
    // baseCreate records as caregiver-mom: the recorder sees their draft, another member does not.
    expect(isVisibleKnowledgeItem(draft, "caregiver-mom")).toBe(true)
    expect(isVisibleKnowledgeItem(draft, "caregiver-dad")).toBe(false)
  })

  it("a composed row round-trips through the document contract; a corrupted row fails the read loudly", () => {
    // Read path: rows decode through KnowledgeDocument and re-run invariants.
    const decoded = storedRow({})
    assertKnowledgeInvariants(decoded)

    // A stored row that violates the contract (current + validUntil) must
    // fail the read instead of serving invalid knowledge.
    const corrupted = storedRow({ validUntil: NOW })
    expect(() => assertKnowledgeInvariants(corrupted)).toThrow(KnowledgeShapeError)
  })
})
