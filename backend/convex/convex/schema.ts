import { defineSchema, defineTable } from "convex/server"
import { Schema } from "effect"

import {
  CareProfileFields,
  ChildFields,
  EntryFields,
  EventFields,
  HouseholdFields,
  KnowledgeFields,
  RawAccessGrantFields,
  RetractionReceiptFields,
} from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

/**
 * Flat blueprint tables. Field validators are DERIVED from the
 * canonical Effect schemas via the tested adapter in @journal/domain/convex —
 * this file defines no field types of its own.
 *
 * `knowledge` is the family-knowledge layer (schema proposal v0.1):
 * source-attributed understanding about the child — settling preferences,
 * routines, quotes, preferences — separate from logged `events`, append-only
 * via supersession, audience-free per contract v0.2.
 *
 * Contract v0.4 tables (Gil settlements 1–3): `retractions` is the
 * append-only retraction receipt (entry row retained; household queries
 * filter through `RetractionFilter`); `care_profiles` is the standing
 * care-context area (allergies, nap schedules, emergency info —
 * caregiver-confirmed only); `raw_access_grants` carries the explicit
 * raw-transcript grants (default-off for cross-household viewers).
 */
const tableFrom = (fields: Schema.Struct.Fields) => defineTable(convexFields(Schema.Struct(fields)))

export default defineSchema({
  households: tableFrom(HouseholdFields),
  children: tableFrom(ChildFields).index("by_household", ["householdId"]),
  entries: tableFrom(EntryFields)
    .index("by_household", ["householdId"])
    .index("by_child", ["childId"])
    // Idempotent captures: lookup by the client-side capture session id.
    .index("by_capture", ["captureId"])
    // Chronological timeline: per-child, oldest first (journal reads forward).
    .index("by_child_createdAt", ["childId", "createdAt"]),
  events: tableFrom(EventFields).index("by_child", ["childId"]),
  knowledge: tableFrom(KnowledgeFields)
    .index("by_household", ["householdId"])
    .index("by_child_topic", ["childId", "topic"])
    .index("by_supersedes", ["supersedes"]),
  // v0.4: retraction receipts — operator/lineage reads resolve the receipt by entry.
  retractions: tableFrom(RetractionReceiptFields)
    .index("by_entry", ["entryId"])
    .index("by_household", ["householdId"]),
  // v0.4: standing care context per child (handoff/digest slots 23/24, Slot 31).
  care_profiles: tableFrom(CareProfileFields)
    .index("by_household", ["householdId"])
    .index("by_child_area", ["childId", "area"])
    .index("by_supersedes", ["supersedes"]),
  // v0.4: raw-transcript grants — default-off for cross-household viewers (slot 20).
  raw_access_grants: tableFrom(RawAccessGrantFields)
    .index("by_household", ["householdId"])
    .index("by_child_grantee", ["childId", "granteeId"]),
})
