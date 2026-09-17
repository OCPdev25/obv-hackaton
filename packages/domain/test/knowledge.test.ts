import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  KnowledgeDocument,
  KnowledgeSchema,
  assertKnowledgeInvariants,
} from "../src/index.js"
import { convexFields } from "../src/convexAdapter.js"
import { toolSchemaFor } from "../src/jsonSchema.js"

const decode = (wire: unknown): KnowledgeDocument =>
  Schema.decodeUnknownSync(KnowledgeSchema)(wire) as KnowledgeDocument
const encode = (item: KnowledgeDocument): unknown => Schema.encodeSync(KnowledgeSchema)(item)

const invariantError = (fn: () => unknown): string => {
  try {
    fn()
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const check = (wire: unknown): void => assertKnowledgeInvariants(decode(wire))

const T_CREATED = 1789588800000

const validSettlingItem: Record<string, unknown> = {
  householdId: "synthetic-household-0001",
  childId: "synthetic-child-0001",
  kind: "settling",
  topic: "settle-white-noise",
  statement: "Falls asleep fastest with white noise on and the door left slightly open.",
  status: "current",
  validFrom: T_CREATED,
  statedBy: "caregiver-mom",
  recordedBy: "extraction-model",
  provenanceKind: "model-extracted",
  confidence: 0.82,
  sourceType: "entry",
  sourceEntryId: "synthetic-entry-0001",
  sourceSpan: { start: 0, end: 74 },
  sourceQuote: "She goes down easiest with the white noise on and the door cracked a little.",
  visibility: "published",
  createdAt: T_CREATED,
}

describe("Knowledge schema (wire)", () => {
  test("decodes a fully attributed settling item and round-trips it byte-identically", () => {
    const item = decode(validSettlingItem)
    expect(item.topic).toBe("settle-white-noise")
    expect(item.provenanceKind).toBe("model-extracted")
    expect(item.sourceSpan?.start).toBe(0)
    expect(encode(item)).toEqual(validSettlingItem)
  })

  test("carries quote and routine data verbatim", () => {
    const quote = decode({
      ...validSettlingItem,
      kind: "quote",
      topic: "sayings",
      statement: "Car-seat astronomy at dusk.",
      quoteText: "The moon is following our car. It loves us.",
      spokenBy: "child",
      sourceQuote: "From the back seat, completely serious: 'The moon is following our car. It loves us.'",
    })
    expect(quote.quoteText).toBe("The moon is following our car. It loves us.")
    expect(quote.spokenBy).toBe("child")
    expect(decode(encode(quote))).toEqual(quote)

    const routine = decode({
      ...validSettlingItem,
      kind: "routine",
      topic: "bedtime-routine",
      statement: "Fixed order, every night.",
      steps: ["warm bath", "pajamas", "two books (she picks)", "white noise on", "lights out"],
    })
    expect(routine.steps).toEqual(["warm bath", "pajamas", "two books (she picks)", "white noise on", "lights out"])
    expect(decode(encode(routine))).toEqual(routine)
  })

  test("rejects vocabulary outside the closed family taxonomy", () => {
    expect(() =>
      decode({ ...validSettlingItem, kind: "medical", statement: "Classic roseola pattern." }),
    ).toThrow()
    expect(() => decode({ ...validSettlingItem, kind: "nap" })).toThrow()
    expect(() => decode({ ...validSettlingItem, visibility: "published:grandparents" })).toThrow()
    expect(() => decode({ ...validSettlingItem, visibility: "shared" })).toThrow()
    expect(() => decode({ ...validSettlingItem, confidence: 1.5 })).toThrow()
    expect(() => decode({ ...validSettlingItem, confidence: Number.NaN })).toThrow()
    expect(() => decode({ ...validSettlingItem, statement: "" })).toThrow()
  })
})

describe("Knowledge invariants (cross-field, enforced by assertKnowledgeInvariants)", () => {
  test("topics are normalized kebab-case slugs", () => {
    expect(invariantError(() => check({ ...validSettlingItem, topic: "Bedtime!!" }))).toContain(
      "topic must be a lowercase kebab-case slug",
    )
  })

  test("kind-specific data is required where it applies", () => {
    expect(
      invariantError(() => check({ ...validSettlingItem, kind: "quote", topic: "sayings", quoteText: undefined })),
    ).toContain("requires quoteText")
    expect(
      invariantError(() => check({ ...validSettlingItem, kind: "routine", topic: "bedtime-routine", steps: undefined })),
    ).toContain("requires steps")
    expect(
      invariantError(() => check({ ...validSettlingItem, kind: "routine", topic: "bedtime-routine", steps: [] })),
    ).toContain("non-empty")
    // kind-specific fields stay on their own kind — no cross-contamination
    expect(invariantError(() => check({ ...validSettlingItem, quoteText: "stolen words" }))).toContain("quoteText")
    expect(invariantError(() => check({ ...validSettlingItem, steps: ["bath", "books"] }))).toContain("steps")
  })

  test("superseded items carry their validity window; current items never do; windows never invert", () => {
    expect(invariantError(() => check({ ...validSettlingItem, status: "superseded" }))).toContain(
      "requires validUntil",
    )
    expect(invariantError(() => check({ ...validSettlingItem, validUntil: T_CREATED }))).toContain("validUntil")
    expect(
      invariantError(() => check({ ...validSettlingItem, status: "superseded", validFrom: 200, validUntil: 100 })),
    ).toContain("validUntil must not precede validFrom")
  })

  test("a document cannot supersede itself", () => {
    const doc = {
      ...validSettlingItem,
      _id: "synthetic-knowledge-0999",
      _creationTime: T_CREATED,
      supersedes: "synthetic-knowledge-0999",
    } as unknown as KnowledgeDocument
    expect(invariantError(() => assertKnowledgeInvariants(doc))).toContain("supersede itself")
  })

  test("confidence 1 is reserved for caregiver confirmation", () => {
    expect(() =>
      check({ ...validSettlingItem, recordedBy: "caregiver-mom", provenanceKind: "caregiver-confirmed", confidence: 1 }),
    ).not.toThrow()
    expect(
      invariantError(() => check({ ...validSettlingItem, provenanceKind: "caregiver-confirmed", confidence: 0.99 })),
    ).toContain("confidence exactly 1")
    expect(invariantError(() => check({ ...validSettlingItem, confidence: 1 }))).toContain("confidence < 1")
    expect(
      invariantError(() =>
        check({ ...validSettlingItem, provenanceKind: "caregiver-confirmed", recordedBy: "extraction-model", confidence: 1 }),
      ),
    ).toContain('cannot be recorded by "extraction-model"')
    // a human may relay the model's guess — what is pinned is that it stays below 1
    expect(() => check({ ...validSettlingItem, recordedBy: "caregiver-mom" })).not.toThrow()
  })

  test("source attribution is required and mutually exclusive", () => {
    expect(
      invariantError(() => check({ ...validSettlingItem, sourceEntryId: undefined })),
    ).toContain('sourceType "entry" requires sourceEntryId')
    expect(
      invariantError(() =>
        check({
          ...validSettlingItem,
          sourceType: "conversation",
          sourceRef: "synthetic-conversation-0004",
          sourceEntryId: "synthetic-entry-0001",
        }),
      ),
    ).toContain("must not carry sourceEntryId")
    expect(() =>
      check({
        ...validSettlingItem,
        sourceType: "manual",
        sourceEntryId: undefined,
        recordedBy: "caregiver-nanny",
        provenanceKind: "caregiver-confirmed",
        confidence: 1,
        sourceSpan: undefined,
      }),
    ).not.toThrow()
    expect(
      invariantError(() =>
        check({
          ...validSettlingItem,
          sourceType: "manual",
          sourceEntryId: undefined,
          sourceRef: "synthetic-conversation-0004",
          recordedBy: "caregiver-nanny",
          provenanceKind: "caregiver-confirmed",
          confidence: 1,
        }),
      ),
    ).toContain('sourceType "manual" must not carry sourceEntryId or sourceRef')
    expect(
      invariantError(() =>
        check({
          ...validSettlingItem,
          sourceType: "manual",
          sourceEntryId: undefined,
          recordedBy: "caregiver-nanny",
          provenanceKind: "caregiver-confirmed",
          confidence: 1,
          sourceSpan: { start: 0, end: 5 },
        }),
      ),
    ).toContain('sourceType "manual" has no source span')
    expect(invariantError(() => check({ ...validSettlingItem, sourceSpan: { start: 10, end: 4 } }))).toContain(
      "sourceSpan.end must not precede sourceSpan.start",
    )
  })
})

describe("Effect -> Convex adapter for knowledge", () => {
  test("derives validators for the knowledge table", () => {
    const fields = convexFields(KnowledgeSchema) as unknown as Record<string, Record<string, unknown>>

    const supersedes = fields.supersedes as { kind: string; tableName: string; isOptional: string }
    expect(supersedes.kind).toBe("id")
    expect(supersedes.tableName).toBe("knowledge")
    expect(supersedes.isOptional).toBe("optional")

    const sourceEntryId = fields.sourceEntryId as { kind: string; tableName: string }
    expect(sourceEntryId.kind).toBe("id")
    expect(sourceEntryId.tableName).toBe("entries")

    const kind = fields.kind as { kind: string; members: Array<{ kind: string; value: string }> }
    expect(kind.kind).toBe("union")
    expect(kind.members).toHaveLength(4)
    expect(kind.members.map((m) => m.value)).toEqual(["settling", "routine", "quote", "preference"])

    const steps = fields.steps as { kind: string; isOptional: string; element: { kind: string } }
    expect(steps.kind).toBe("array")
    expect(steps.isOptional).toBe("optional")
    expect(steps.element.kind).toBe("string")

    const sourceSpan = fields.sourceSpan as {
      kind: string
      isOptional: string
      fields: Record<string, { kind: string }>
    }
    expect(sourceSpan.kind).toBe("object")
    expect(sourceSpan.isOptional).toBe("optional")
    expect(sourceSpan.fields.start?.kind).toBe("float64")
    expect(sourceSpan.fields.end?.kind).toBe("float64")

    const visibility = fields.visibility as { kind: string; members: Array<{ kind: string; value: string }> }
    expect(visibility.kind).toBe("union")
    expect(visibility.members.map((m) => m.value)).toEqual(["draft", "published"])

    expect((fields.topic as { kind: string }).kind).toBe("string")
    expect((fields.confidence as { kind: string }).kind).toBe("float64")
  })
})

describe("JSON Schema tool contract", () => {
  test("derives a draft-2020-12 contract carrying exactly the four kinds", () => {
    const toolContract = toolSchemaFor(KnowledgeSchema) as unknown as {
      dialect: string
      schema: { properties: { kind: { enum: string[] } } }
    }
    expect(toolContract.dialect).toBe("draft-2020-12")
    expect(toolContract.schema.properties.kind.enum).toEqual(["settling", "routine", "quote", "preference"])
  })
})

// ---------------------------------------------------------------------------
// Synthetic acceptance fixtures — knowledge contract v0.1
// ---------------------------------------------------------------------------

type KnowledgeFixtureItem = KnowledgeDocument
type KnowledgeFixture = {
  readonly kind: string
  readonly id: string
  readonly description: string
  readonly items?: readonly KnowledgeFixtureItem[]
  readonly cases?: ReadonlyArray<{
    readonly name: string
    readonly rejectAt: "decode" | "invariants"
    readonly item: Record<string, unknown>
  }>
  readonly expected?: {
    readonly itemCount?: number
    readonly topics?: string[]
    readonly kindCounts?: Record<string, number>
    readonly statusCounts?: Record<string, number>
    readonly visibilityCounts?: Record<string, number>
    readonly supersedesCount?: number
    readonly supersedesReferences?: string[]
    readonly validUntilCount?: number
    readonly spokenByCounts?: Record<string, number>
    readonly conflictTopics?: string[]
  }
}

const fixturesDir = join(import.meta.dir, "fixtures", "knowledge")
const fixtureFiles = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
expect(fixtureFiles.length).toBeGreaterThanOrEqual(6)

const countBy = (
  items: readonly KnowledgeDocument[],
  key: "kind" | "status" | "visibility",
): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1
  return counts
}

describe("Synthetic acceptance fixtures", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8")) as KnowledgeFixture

    if (fixture.cases !== undefined) {
      test(`${file}: ${fixture.id} — rejects every invalid item at the declared layer`, () => {
        expect(fixture.cases?.length ?? 0).toBeGreaterThan(0)
        for (const testCase of fixture.cases ?? []) {
          if (testCase.rejectAt === "decode") {
            expect(() => decode(testCase.item)).toThrow()
          } else {
            expect(() => assertKnowledgeInvariants(testCase.item as unknown as KnowledgeDocument)).toThrow()
          }
        }
      })
      continue
    }

    test(`${file}: ${fixture.id} — decodes, satisfies invariants, round-trips, matches expectations`, () => {
      const items = (fixture.items ?? []).map((item) => decode(item))

      const expected = fixture.expected ?? {}
      if (expected.itemCount !== undefined) expect(items.length).toBe(expected.itemCount)

      for (const item of items) expect(() => assertKnowledgeInvariants(item)).not.toThrow()
      for (const item of items) expect(decode(encode(item))).toEqual(item)

      if (expected.topics !== undefined) {
        expect([...new Set(items.map((i) => i.topic))].sort()).toEqual(expected.topics)
      }
      if (expected.kindCounts !== undefined) expect(countBy(items, "kind")).toEqual(expected.kindCounts)
      if (expected.statusCounts !== undefined) expect(countBy(items, "status")).toEqual(expected.statusCounts)
      if (expected.visibilityCounts !== undefined)
        expect(countBy(items, "visibility")).toEqual(expected.visibilityCounts)
      if (expected.supersedesCount !== undefined) {
        expect(items.filter((i) => i.supersedes !== undefined)).toHaveLength(expected.supersedesCount)
      }
      if (expected.supersedesReferences !== undefined) {
        const refs = items
          .filter((i) => i.supersedes !== undefined)
          .map((i) => i.supersedes as string)
        expect(refs).toEqual(expected.supersedesReferences)
      }
      if (expected.validUntilCount !== undefined) {
        expect(items.filter((i) => i.validUntil !== undefined)).toHaveLength(expected.validUntilCount)
      }
      if (expected.spokenByCounts !== undefined) {
        const counts: Record<string, number> = {}
        for (const item of items) {
          if (item.spokenBy !== undefined) counts[item.spokenBy] = (counts[item.spokenBy] ?? 0) + 1
        }
        expect(counts).toEqual(expected.spokenByCounts)
      }
      // conflicts stay visible: >= 2 current items per conflicted topic, distinct statedBy
      for (const topic of expected.conflictTopics ?? []) {
        const current = items.filter((i) => i.topic === topic && i.status === "current")
        expect(current.length).toBeGreaterThanOrEqual(2)
        expect(new Set(current.map((i) => i.statedBy)).size).toBe(current.length)
      }
    })
  }
})
