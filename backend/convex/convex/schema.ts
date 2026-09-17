import { defineSchema, defineTable } from "convex/server"
import { Schema } from "effect"

import { ChildFields, EntryFields, EventFields, HouseholdFields } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

/**
 * The four flat blueprint tables. Field validators are DERIVED from the
 * canonical Effect schemas via the tested adapter in @journal/domain/convex —
 * this file defines no field types of its own.
 */
const tableFrom = (fields: Schema.Struct.Fields) => defineTable(convexFields(Schema.Struct(fields)))

export default defineSchema({
  households: tableFrom(HouseholdFields),
  children: tableFrom(ChildFields).index("by_household", ["householdId"]),
  entries: tableFrom(EntryFields).index("by_household", ["householdId"]).index("by_child", ["childId"]),
  events: tableFrom(EventFields).index("by_child", ["childId"]),
})
