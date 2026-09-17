import { defineSchema, defineTable } from "convex/server"
import { Schema } from "effect"

import {
  CaregiverReadStateFields,
  ChildFields,
  EntryFields,
  EventFields,
  HouseholdFields,
  KnowledgeFields,
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
  // Since-last-seen read state (catch-up contract delta v0.1, art_6qhBut41):
  // one monotonic watermark row per (caregiver, child). Additive only.
  caregiverReadState: tableFrom(CaregiverReadStateFields).index("by_caregiver_child", [
    "caregiverId",
    "childId",
  ]),
})
