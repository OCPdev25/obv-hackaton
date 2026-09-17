/**
 * Synthetic fixtures: one child, two caregivers. Data only — the backend
 * mints real Convex ids at seed time. These are fixtures, not schema limits:
 * nothing in the schema caps children or caregivers per household.
 */

export const FIXTURE_HOUSEHOLD = { name: "Rivera Household" } as const

export const FIXTURE_CHILD = { name: "Maya", birthdate: "2024-03-11" } as const

export const FIXTURE_CAREGIVERS = [
  { name: "Alex", role: "technical owner" },
  { name: "Sam", role: "co-parent" },
] as const
