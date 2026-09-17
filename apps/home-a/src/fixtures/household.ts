/**
 * Synthetic household — the Polanco Household. 100% synthetic demo data; no
 * real user data anywhere in this candidate. Members mirror the product scope:
 * known parents + one caregiver who arrives by explicit invitation (never
 * anonymous, never mass-assigned).
 */
import { Schema } from "effect"
import { ChildSchema, type Child } from "@journal/domain"

import type { HouseholdSeed, Member, Principal } from "../journal/store"

export const HOUSEHOLD_ID = "hh_polanco_household"
export const HOUSEHOLD_NAME = "Polanco Household"
export const TIMEZONE = "America/New_York"

/** Local (EDT) wall-clock → unix ms for September 2026 (EDT = UTC−4). */
export const at = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 8, day, hour + 4, minute)

export const MEMBERS: readonly Member[] = [
  { memberId: "mem_dana", displayName: "Dana Polanco", role: "parent", alias: "Mom", lastCheckedAt: null },
  { memberId: "mem_gilbert", displayName: "Gilbert Polanco", role: "parent", alias: "Dad", lastCheckedAt: null },
  { memberId: "mem_rosa", displayName: "Rosa Marin", role: "caregiver", alias: "Nana Rosa", lastCheckedAt: null },
]

/** Children as decoded domain Child documents (schema-validated). */
export function childrenDocs(): readonly Child[] {
  return [
    Schema.decodeUnknownSync(ChildSchema)({
      householdId: HOUSEHOLD_ID,
      name: "Milo",
      birthDate: Date.UTC(2022, 4, 12), // age 4 in September 2026
      createdAt: at(1, 0, 0),
    }),
    Schema.decodeUnknownSync(ChildSchema)({
      householdId: HOUSEHOLD_ID,
      name: "Iris",
      birthDate: Date.UTC(2025, 2, 30), // 18 months in September 2026
      createdAt: at(1, 0, 0),
    }),
  ]
}

export const HOUSEHOLD_SEED: HouseholdSeed = {
  householdId: HOUSEHOLD_ID,
  householdName: HOUSEHOLD_NAME,
  timezone: TIMEZONE,
  members: MEMBERS.map((member) => ({ ...member })),
  children: [
    { childId: "ch_milo", name: "Milo", aliases: ["big guy"] },
    { childId: "ch_iris", name: "Iris", aliases: ["little one"] },
  ],
}

/** Build a fail-closed principal for a known member (household path included). */
export function memberPrincipal(memberId: string): Principal {
  const member = MEMBERS.find((candidate) => candidate.memberId === memberId)
  if (member === undefined) {
    // Not on the roster: a principal with NO household path — every check denies.
    return { kind: "member", memberId, role: "caregiver", householdIds: [] }
  }
  return { kind: "member", memberId, role: member.role, householdIds: [HOUSEHOLD_ID] }
}

/** A deliberately unauthenticated principal for fail-closed demos. */
export const anonymousPrincipal: Principal = { kind: "anonymous" }
