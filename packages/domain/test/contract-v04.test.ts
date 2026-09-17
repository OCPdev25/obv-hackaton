import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CareProfileDocument,
  CareProfileSchema,
  EntrySchema,
  ListEntriesByChildInput,
  RawAccessGrantDocument,
  RawAccessGrantSchema,
  RetractionFilter,
  RetractionReceiptDocument,
  RetractionReceiptSchema,
  StructuredEntryView,
  assertCareProfileInvariants,
  assertRawAccessGrantInvariants,
  excludesRetracted,
  isGrantActive,
  rawTranscriptVisible,
  toStructuredEntryView,
  toolSchemaFor,
} from "../src/index.js"
import { convexFields } from "../src/convexAdapter.js"

/**
 * Contract v0.4 fold tests (Gil settlements 1–3, 2026-09-17). These pin the
 * folded additions — the append-only retraction receipt and query filter
 * hook, the caregiver-confirmed CareProfile area, and the default-off
 * raw-access-by-grant model — to the rules the contract is held to: unix-ms
 * dates, no explicit nulls, no underscore-prefixed stored fields, and the
 * settled separation of publication state, audience, retraction, and
 * raw-access as independent dimensions.
 */

const T = 1758136800000

const receipt = {
  householdId: "jd7civil0000000000000000",
  childId: "jd7cchild00000000000000000",
  entryId: "jd7centry0000000000000000",
  retractedBy: "caregiver-mom",
  retractedAt: T,
} satisfies Record<string, unknown>

const careProfileItem = {
  householdId: "jd7civil0000000000000000",
  childId: "jd7cchild00000000000000000",
  area: "allergy",
  statement: "Sofia is allergic to penicillin — rash and swelling, confirmed at urgent care.",
  status: "current",
  validFrom: T,
  statedBy: "caregiver-mom",
  recordedBy: "caregiver-mom",
  provenanceKind: "caregiver-confirmed",
  confidence: 1,
  sourceType: "entry",
  sourceEntryId: "jd7centry0000000000000000",
  sourceSpan: { start: 0, end: 60 },
  sourceQuote: "The doctor confirmed she's allergic to penicillin.",
  visibility: "published",
  createdAt: T,
} satisfies Record<string, unknown>

const activeGrant = {
  householdId: "jd7civil0000000000000000",
  childId: "jd7cchild00000000000000000",
  granteeId: "grandma-external",
  grantedBy: "caregiver-mom",
  status: "granted",
  grantedAt: T,
  createdAt: T,
} satisfies Record<string, unknown>

const baseEntry = {
  householdId: "jd7civil0000000000000000",
  childId: "jd7cchild00000000000000000",
  authorId: "caregiver-mom",
  rawTranscript: "She napped 45 minutes after lunch.",
  structuredEventIds: [],
  extractionStatus: "pending",
  visibility: "published",
  createdAt: T,
} satisfies Record<string, unknown>

describe("Retraction receipt (v0.4 — settlement 1)", () => {
  test("a receipt decodes, encodes, and round-trips identically", () => {
    const decoded = Schema.decodeUnknownSync(RetractionReceiptSchema)(receipt)
    expect(decoded.entryId).toBe("jd7centry0000000000000000")
    expect(decoded.retractedAt).toBe(T)
    expect(decoded.detail).toBeUndefined()

    const encoded = Schema.encodeSync(RetractionReceiptSchema)(decoded)
    const redecoded = Schema.decodeUnknownSync(RetractionReceiptSchema)(encoded)
    expect(redecoded).toEqual(decoded)
  })

  test("the receipt document decodes with Convex system fields", () => {
    const doc = Schema.decodeUnknownSync(RetractionReceiptDocument)({
      ...receipt,
      detail: "Duplicate of this morning's nap entry.",
      _id: "jd7cretr0000000000000000",
      _creationTime: T,
    })
    expect(doc.detail).toBe("Duplicate of this morning's nap entry.")
    expect(JSON.stringify(doc)).not.toContain("_tag")
  })

  test("empty detail and empty retractedBy are rejected", () => {
    expect(() => Schema.decodeUnknownSync(RetractionReceiptSchema)({ ...receipt, retractedBy: "" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RetractionReceiptDocument)({
        ...receipt,
        detail: "",
        _id: "jd7cretr0000000000000000",
        _creationTime: T,
      })
    ).toThrow()
  })

  test("Entry carries the retracted state: absent by default, set from the receipt", () => {
    const plain = Schema.decodeUnknownSync(EntrySchema)(baseEntry)
    expect(plain.retractedAt).toBeUndefined()

    const retracted = Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, retractedAt: T + 5 })
    expect(retracted.retractedAt).toBe(T + 5)

    // No explicit nulls on the wire — a retracted state is absent or a number.
    expect(() => Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, retractedAt: null })).toThrow()
  })

  test("the retraction filter hook excludes by default and names the operator path", () => {
    // Absent filter => household default => retracted entries are EXCLUDED.
    expect(excludesRetracted(undefined)).toBe(true)
    expect(excludesRetracted(Schema.decodeUnknownSync(RetractionFilter)({}))).toBe(true)
    expect(excludesRetracted(Schema.decodeUnknownSync(RetractionFilter)({ retractionScope: "household" }))).toBe(true)
    // Operator scope is the ONLY include path (operator/lineage reads).
    expect(excludesRetracted(Schema.decodeUnknownSync(RetractionFilter)({ retractionScope: "operator" }))).toBe(false)
    expect(() => Schema.decodeUnknownSync(RetractionFilter)({ retractionScope: "bogus" })).toThrow()
  })

  test("query inputs embed the filter as an optional hook", () => {
    const without = Schema.decodeUnknownSync(ListEntriesByChildInput)({ childId: "jd7cchild00000000000000000" })
    expect(without.retraction).toBeUndefined()

    const withFilter = Schema.decodeUnknownSync(ListEntriesByChildInput)({
      childId: "jd7cchild00000000000000000",
      retraction: { retractionScope: "operator" },
    })
    expect(withFilter.retraction?.retractionScope).toBe("operator")
    expect(excludesRetracted(withFilter.retraction)).toBe(false)
  })

  test("the adapter maps the receipt table: entry/household/child ids, optional detail", () => {
    const fields = convexFields(RetractionReceiptSchema)
    const entryId = fields.entryId as { kind: string; tableName: string }
    expect(entryId.kind).toBe("id")
    expect(entryId.tableName).toBe("entries")

    const detail = fields.detail as { kind: string; isOptional: string }
    expect(detail.kind).toBe("string")
    expect(detail.isOptional).toBe("optional")

    // The filter hook derives for function args too.
    const listArgs = convexFields(ListEntriesByChildInput)
    const retraction = listArgs.retraction as { kind: string; isOptional: string }
    expect(retraction.kind).toBe("object")
    expect(retraction.isOptional).toBe("optional")
  })
})

describe("CareProfile (v0.4 — settlement 2)", () => {
  test("a caregiver-confirmed allergy item decodes, encodes, and round-trips identically", () => {
    const decoded = Schema.decodeUnknownSync(CareProfileSchema)(careProfileItem)
    expect(decoded.area).toBe("allergy")
    expect(decoded.provenanceKind).toBe("caregiver-confirmed")
    expect(decoded.confidence).toBe(1)
    expect(decoded.sourceQuote).toBe("The doctor confirmed she's allergic to penicillin.")

    const encoded = Schema.encodeSync(CareProfileSchema)(decoded)
    const redecoded = Schema.decodeUnknownSync(CareProfileSchema)(encoded)
    expect(redecoded).toEqual(decoded)
  })

  test("all three settled areas decode — nap schedule and emergency info included", () => {
    for (const area of ["nap-schedule", "emergency"] as const) {
      const decoded = Schema.decodeUnknownSync(CareProfileSchema)({
        ...careProfileItem,
        area,
        statement: area === "nap-schedule" ? "One nap after lunch, usually 12:30–13:30." : "Pediatrician: Dr. Rivera, 555-0142.",
        provenanceKind: "caregiver-stated",
        confidence: 0.9,
      })
      expect(decoded.area).toBe(area)
      expect(assertCareProfileInvariants(decoded)).toBeUndefined()
    }
  })

  test("the area union is closed — no diagnosis or other medical area encodes", () => {
    expect(() => Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, area: "diagnosis" })).toThrow()
    expect(() => Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, area: "medical" })).toThrow()
  })

  test("model-extracted provenance cannot encode — no automatic inference of care facts", () => {
    expect(() =>
      Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, provenanceKind: "model-extracted" })
    ).toThrow()
  })

  test("the extraction model can never record a care-profile item", () => {
    const item = Schema.decodeUnknownSync(CareProfileSchema)({
      ...careProfileItem,
      recordedBy: "extraction-model",
    })
    expect(() => assertCareProfileInvariants(item)).toThrow(/no automatic inference/)
  })

  test("the confidence partition mirrors knowledge: 1 is caregiver-confirmed only", () => {
    const wrongConfirmed = Schema.decodeUnknownSync(CareProfileSchema)({
      ...careProfileItem,
      provenanceKind: "caregiver-confirmed",
      confidence: 0.8,
    })
    expect(() => assertCareProfileInvariants(wrongConfirmed)).toThrow(/confidence exactly 1/)

    const overstated = Schema.decodeUnknownSync(CareProfileSchema)({
      ...careProfileItem,
      provenanceKind: "caregiver-stated",
      confidence: 1,
    })
    expect(() => assertCareProfileInvariants(overstated)).toThrow(/confidence < 1/)
  })

  test("supersession is append-only: validUntil pairing, ordering, no self-supersession", () => {
    const superseded = Schema.decodeUnknownSync(CareProfileDocument)({
      ...careProfileItem,
      status: "superseded",
      validUntil: T + 1000,
      _id: "jd7ccare00000000000000001",
      _creationTime: T,
    })
    expect(assertCareProfileInvariants(superseded)).toBeUndefined()

    expect(() =>
      assertCareProfileInvariants(
        Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, status: "superseded" })
      )
    ).toThrow(/requires validUntil/)
    expect(() =>
      assertCareProfileInvariants(Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, validUntil: T + 1000 }))
    ).toThrow(/must not carry validUntil/)
    expect(() =>
      assertCareProfileInvariants(
        Schema.decodeUnknownSync(CareProfileDocument)({
          ...careProfileItem,
          status: "superseded",
          validUntil: T - 1000,
          _id: "jd7ccare00000000000000002",
          _creationTime: T,
        })
      )
    ).toThrow(/must not precede validFrom/)
    expect(() =>
      assertCareProfileInvariants(
        Schema.decodeUnknownSync(CareProfileDocument)({
          ...careProfileItem,
          supersedes: "jd7ccare00000000000000003",
          _id: "jd7ccare00000000000000003",
          _creationTime: T,
        })
      )
    ).toThrow(/cannot supersede itself/)
  })

  test("source attribution mirrors knowledge: entry/conversation/manual point back at their source", () => {
    expect(() =>
      assertCareProfileInvariants(Schema.decodeUnknownSync(CareProfileSchema)({ ...careProfileItem, sourceType: "entry" }))
    ).not.toThrow()

    // optionalKey fields must be ABSENT, never present-with-undefined (the
    // v0.3 wire rule) — variants drop keys by destructuring them out.
    const { sourceEntryId: _se, ...entryless } = careProfileItem
    const { sourceSpan: _ss, ...noSpan } = entryless
    const { sourceQuote: _sq, ...bare } = noSpan

    // entry source without the entry id is incomplete...
    const noEntry = Schema.decodeUnknownSync(CareProfileSchema)(entryless)
    expect(() => assertCareProfileInvariants(noEntry)).toThrow(/requires sourceEntryId/)

    // conversation sources carry a sourceRef instead...
    const conversation = Schema.decodeUnknownSync(CareProfileSchema)({
      ...bare,
      sourceType: "conversation",
      sourceRef: "whatsapp-thread-42",
      provenanceKind: "caregiver-stated",
      confidence: 0.9,
    })
    expect(assertCareProfileInvariants(conversation)).toBeUndefined()

    // and manual authorship is caregiver-confirmed with no extraction involved.
    const manual = Schema.decodeUnknownSync(CareProfileSchema)({
      ...bare,
      sourceType: "manual",
    })
    expect(assertCareProfileInvariants(manual)).toBeUndefined()
    const manualStated = Schema.decodeUnknownSync(CareProfileSchema)({
      ...bare,
      sourceType: "manual",
      provenanceKind: "caregiver-stated",
      confidence: 0.9,
    })
    expect(() => assertCareProfileInvariants(manualStated)).toThrow(/direct human authorship/)
  })

  test("the adapter maps the care_profiles table: area literal union, supersede id, optional keys", () => {
    const fields = convexFields(CareProfileSchema)
    const area = fields.area as { kind: string; members: unknown[] }
    expect(area.kind).toBe("union")
    expect(area.members).toHaveLength(3)

    const supersedes = fields.supersedes as { kind: string; tableName: string; isOptional: string }
    expect(supersedes.kind).toBe("id")
    expect(supersedes.tableName).toBe("care_profiles")
    expect(supersedes.isOptional).toBe("optional")

    const validUntil = fields.validUntil as { kind: string; isOptional: string }
    expect(validUntil.kind).toBe("float64")
    expect(validUntil.isOptional).toBe("optional")
  })

  test("the care profile is audience-free: no audience field exists on the item", () => {
    const fields = Object.keys(convexFields(CareProfileSchema))
    expect(fields).not.toContain("audience")
    expect(fields).toContain("visibility")
  })
})

describe("Raw-access-by-grant (v0.4 — settlement 3)", () => {
  test("an active grant decodes, encodes, and round-trips identically", () => {
    const decoded = Schema.decodeUnknownSync(RawAccessGrantSchema)(activeGrant)
    expect(decoded.status).toBe("granted")
    expect(isGrantActive(decoded)).toBe(true)

    const encoded = Schema.encodeSync(RawAccessGrantSchema)(decoded)
    const redecoded = Schema.decodeUnknownSync(RawAccessGrantSchema)(encoded)
    expect(redecoded).toEqual(decoded)
  })

  test("revocation is an append to the grant record, never a delete", () => {
    const revoked = Schema.decodeUnknownSync(RawAccessGrantDocument)({
      ...activeGrant,
      status: "revoked",
      revokedAt: T + 2000,
      _id: "jd7cgran0000000000000000",
      _creationTime: T,
    })
    expect(isGrantActive(revoked)).toBe(false)
    expect(assertRawAccessGrantInvariants(revoked)).toBeUndefined()

    // A revoked record without its revocation timestamp is incomplete, and a
    // granted record must not carry one.
    expect(() =>
      assertRawAccessGrantInvariants(
        Schema.decodeUnknownSync(RawAccessGrantSchema)({ ...activeGrant, status: "revoked" })
      )
    ).toThrow(/requires revokedAt/)
    expect(() =>
      assertRawAccessGrantInvariants(Schema.decodeUnknownSync(RawAccessGrantSchema)({ ...activeGrant, revokedAt: T + 1 }))
    ).toThrow(/must not carry revokedAt/)
    expect(() =>
      assertRawAccessGrantInvariants(
        Schema.decodeUnknownSync(RawAccessGrantSchema)({
          ...activeGrant,
          status: "revoked",
          grantedAt: T + 10,
          revokedAt: T,
        })
      )
    ).toThrow(/must not precede grantedAt/)
  })

  test("default-off: a cross-household viewer without a grant sees structured entries only", () => {
    // No grant record at all — the absence IS the denial.
    expect(rawTranscriptVisible("cross-household", undefined)).toBe(false)
    // A revoked grant is not access.
    const revoked = Schema.decodeUnknownSync(RawAccessGrantSchema)({
      ...activeGrant,
      status: "revoked",
      revokedAt: T + 2000,
    })
    expect(rawTranscriptVisible("cross-household", revoked)).toBe(false)
    // An explicit, active grant is the only cross-household path to the verbatim transcript.
    const active = Schema.decodeUnknownSync(RawAccessGrantSchema)(activeGrant)
    expect(rawTranscriptVisible("cross-household", active)).toBe(true)
  })

  test("same-household membership reads raw transcripts under the existing rules", () => {
    expect(rawTranscriptVisible("same-household", undefined)).toBe(true)
    expect(rawTranscriptVisible("same-household", null as never)).toBe(true)
  })

  test("StructuredEntryView is the entry projection WITHOUT the verbatim transcript", () => {
    const entry = Schema.decodeUnknownSync(EntrySchema)(baseEntry)
    const projected = toStructuredEntryView(entry)
    // The verbatim field is dropped by construction; the structured state survives.
    expect("rawTranscript" in projected).toBe(false)
    expect(projected.visibility).toBe("published")
    expect(projected.extractionStatus).toBe("pending")

    // Even a full entry-shaped payload decodes into the projection with the
    // transcript stripped — the projection cannot leak the field.
    const decoded = Schema.decodeUnknownSync(StructuredEntryView)(baseEntry)
    expect("rawTranscript" in decoded).toBe(false)
  })

  test("the grant record is a third dimension: no visibility, no audience, no retraction fields", () => {
    const fields = Object.keys(convexFields(RawAccessGrantSchema))
    expect(fields).not.toContain("visibility")
    expect(fields).not.toContain("audience")
    expect(fields).not.toContain("retractedAt")
    // ...and it is not a fused publication/permission enum — the grant status
    // literal is not a valid Entry visibility value; the dimensions share nothing.
    expect(() => Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, visibility: "granted" })).toThrow()
  })

  test("the adapter maps the raw_access_grants table", () => {
    const fields = convexFields(RawAccessGrantSchema)
    const granteeId = fields.granteeId as { kind: string }
    expect(granteeId.kind).toBe("string")

    const status = fields.status as { kind: string; members: unknown[] }
    expect(status.kind).toBe("union")
    expect(status.members).toHaveLength(2)

    const childId = fields.childId as { kind: string; tableName: string }
    expect(childId.kind).toBe("id")
    expect(childId.tableName).toBe("children")

    const revokedAt = fields.revokedAt as { kind: string; isOptional: string }
    expect(revokedAt.kind).toBe("float64")
    expect(revokedAt.isOptional).toBe("optional")
  })
})

describe("JSON Schema derivation (v0.4)", () => {
  const schemas: Array<[string, unknown]> = [
    ["RetractionReceiptSchema", RetractionReceiptSchema],
    ["RetractionReceiptDocument", RetractionReceiptDocument],
    ["RetractionFilter", RetractionFilter],
    ["CareProfileSchema", CareProfileSchema],
    ["CareProfileDocument", CareProfileDocument],
    ["RawAccessGrantSchema", RawAccessGrantSchema],
    ["RawAccessGrantDocument", RawAccessGrantDocument],
    ["StructuredEntryView", StructuredEntryView],
  ]

  for (const [name, schema] of schemas) {
    test(`derives a draft-2020-12 contract for ${name}`, () => {
      const document = toolSchemaFor(schema)
      expect(JSON.stringify(document)).toContain("2020-12")
    })
  }

  test("the retraction area enum survives into the care-profile tool contract", () => {
    const json = JSON.stringify(toolSchemaFor(CareProfileSchema))
    for (const area of ["allergy", "nap-schedule", "emergency"]) {
      expect(json).toContain(`"${area}"`)
    }
  })
})
