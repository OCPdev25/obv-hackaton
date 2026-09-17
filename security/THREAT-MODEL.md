# Household Membership & Visibility — Threat Model (v0.1)

**Status:** Active. Executable negative cases in [`access/policy.test.ts`](./access/policy.test.ts) (17 tests, all passing).
**Schema contract:** artifact `art_I2TCG08V` — "Shared Child Journal — Effect v4 Schema Contract (v0.1)".
**Spike dependency (PENDING):** the contract LANDED in `spikes/effect-compat/src/schema.ts` on branch `spike/effect-contracts-adapters`, but that branch was **not pushed to origin** when this model was written (verified via `git ls-remote --heads origin`). Per contract rule 1, tests run against the documented shape mock in [`access/schema-mock.ts`](./access/schema-mock.ts). **Wiring these tests to the real package is pending** — swap the import when the spike lands.

---

## 1. Scope

Authorization for the Shared Child Journal: who may **read** or **write** which journal artifact (child profile, entry, raw transcript, extraction event), and under what conditions. This model covers **membership and visibility** only — it does not cover transport security, device compromise, or provider-side access (Convex/Expo infrastructure), which are separate boundaries owned by the platform.

Guiding principle, applied everywhere: **fail-closed**. Every decision defaults to DENY. An ALLOW requires every applicable check to pass; missing, malformed, or unknown data denies — it never falls open.

## 2. Actors

| Actor | Trust level | Description |
|---|---|---|
| **Caregiver A** | Member, household 1 | Authenticated caregiver in the child's household. Author of content; may hold unpublished (draft) entries. |
| **Caregiver B** | Member, household 1 | Authenticated co-caregiver in the SAME household as A. Different identity from A. Membership gives household-audience rights; it does **not** give author rights on A's drafts. |
| **Non-member caregiver** | Member of household 2 (or unaffiliated) | A legitimate, authenticated user of the system who holds **no membership** in the target child's household. The most important abuse class to model because every request they make is well-formed and credentialed — only the household path is missing. |
| **Anonymous** | None | No session, no token. Includes scrapers, link-preview fetchers, and leaked-URL holders. Trust level zero; every request denied. |

## 3. Assets

| Asset | Contract field | Sensitivity | Rationale |
|---|---|---|---|
| **Child profile** | *not yet in contract* (required extension, §8) | High | Identity and scoping root; every journal artifact resolves through it. |
| **Entries** | `Entry` (capture record) | High | The full capture record: transcript, author, timestamps, derived events, publication status. |
| **Raw transcripts** | `Entry.transcript` — "always preserved" | **Highest** | Verbatim caregiver speech. May include adult conflict, medical, legal, or financial context. This product serves separated/co-parenting households, so transcripts are plausible custody-dispute evidence; leaking one harms the child and the family, not just an account. |
| **Extraction events** | `Entry.events` (`Event[]`) | High | Structured care data (category, quantity, confidence, note). Even without raw text, events reveal that a transcript existed and what it was about — a side-channel into draft content if visible separately. |

## 4. Trust boundaries

**B0 — Authentication edge.** Everything west of this boundary is unauthenticated (Anonymous actor). The contract carries `authorId` on both Entry and Event, which makes attribution possible only for authenticated principals — anonymous requests never reach attribution.

**B1 — Household membership** *(primary tenancy boundary)*. All journal data is household-scoped. A principal touches a child's data only through an **explicit membership path**: principal ∈ roster(household(child)). Membership is a server-maintained roster fact — never inferred from a link, a share sheet, a phone contact, or a URL. Crossing B1 without membership is the canonical denial (`DENY_NO_HOUSEHOLD_PATH`).

**B2 — Child scoping.** The child is the unit of timeline access: every resource resolves through exactly one `(childId, householdId)` scope. Child scoping is an **independent** check, not an alias for household membership — it forces every access to name the child it touches, which is what makes per-child timelines (and future per-child audience grants) enforceable. Incomplete scoping data denies outright (`DENY_UNKNOWN_CHILD_SCOPE`). Current product reality: one owning household per child; multi-household children (separated families sharing a child across two households) are a future extension that must arrive as explicit audience grants, never as a second implicit path.

**B3 — Publication state** *(within-household visibility line)*. `Entry.status ∈ {draft, published}` (contract). Drafts are author-only. See §5 — this is a *dimension*, not an audience level.

## 5. The two-dimension rule (core design decision)

**Publication state and audience permission are SEPARATE dimensions. They must NOT be modeled as one `draft/shared` enum.**

- **Dimension 1 — Publication state** (`Entry.status: 'draft' | 'published'`, from contract v0.1): the *authoring lifecycle*. Has the author released this content into the shared timeline?
- **Dimension 2 — Audience permission** (household membership path × child scoping, plus any future explicit audience grants): *who is even eligible*.

Truth table (read = viewing the entry or its events):

| Publication state | Audience eligibility | Outcome | Reason |
|---|---|---|---|
| draft | author (Caregiver A) | **ALLOW** | own draft |
| draft | co-member (Caregiver B) | **DENY** | `DENY_DRAFT_AUTHOR_ONLY` |
| draft | non-member / anonymous | **DENY** | `DENY_NO_HOUSEHOLD_PATH` / `DENY_ANONYMOUS` |
| published | co-member (Caregiver B) | **ALLOW** | household-audience content |
| published | non-member | **DENY** | `DENY_NO_HOUSEHOLD_PATH` — publication does NOT confer membership |
| published | anonymous | **DENY** | `DENY_ANONYMOUS` |

Why the split is load-bearing:

1. **Publication never widens the audience.** A published entry is visible to the household audience — not to "anyone with the app". An enum where `published` means "shared" invites exactly that bug: the second dimension quietly disappears because the enum carries no room for it.
2. **Membership does not pierce drafts.** A single scalar that treats "member of the household" as "can see the child's stuff" will leak drafts to co-members. Draft visibility is a property of the author, independent of membership.
3. **Independent testability.** AB-4/AB-10 prove dimension 1 denies *within* an eligible audience; AB-7/AB-7b prove dimension 2 denies *regardless of* dimension 1. `DIM-1` composes both: one timeline, three principals, three different projections. If either dimension regresses into the other, a named test fails.
4. **Room to grow.** Future per-entry audience grants (e.g., a specific caregiver, a second household for a shared child) extend dimension 2 without touching dimension 1. A conflated enum would have to be migrated.

## 6. Abuse cases

Severity: **Critical** = unauthenticated or bulk cross-tenant exposure of transcripts; **High** = any authenticated cross-household access; **Medium** = intra-household visibility violation (draft leakage, attribution fraud); **Low** = informational.

| ID | Abuse case | Actor → asset | Boundary | Severity | Expected outcome | Executable test |
|---|---|---|---|---|---|---|
| AB-1 | Caregiver of household 1 reads household 2's child timeline | Caregiver A → child profile/timeline of H2 | B1, B2 | High | DENY | `AB-1` |
| AB-2 | Writing an entry to another household's child | Caregiver A → entry on H2's child | B1 | High | DENY | `AB-2` |
| AB-3 | Non-member reads ANY child | Unaffiliated caregiver → every child | B1, B2 | High | DENY for each child | `AB-3` |
| AB-4 | Unpublished (draft) entry read by co-caregiver | Caregiver B → Caregiver A's draft (same household) | B3 | Medium | DENY (B); ALLOW (A) | `AB-4`, `PC-4` |
| AB-5 | Anonymous reads a child timeline | Anonymous → any child | B0 | Critical | DENY | `AB-5` |
| AB-6 | Anonymous writes an entry | Anonymous → any child | B0 | Critical | DENY | `AB-6` |
| AB-7 | Non-member reads a PUBLISHED entry (publication ≠ public) | Caregiver of H2 → published entry in H1 | B1 | High | DENY | `AB-7`, `AB-7b` |
| AB-9 | Attribution spoof: write attributed to another caregiver | Caregiver B → entry claiming `authorId: caregiver-a` | B0 | Medium | DENY | `AB-9` |
| AB-10 | Draft extraction events read as a side-channel | Caregiver B → `Event[]` of A's draft | B3 | Medium | DENY | `AB-10` |
| AB-12 | Missing/malformed scoping data (unknown child or household) | Any → incomplete scope | B2 (fail-closed) | High | DENY, never open | `AB-12`, `AB-12b` |
| DIM-1 | Projection divergence (dimensions composed) | A / B / non-member → same timeline | B1×B3 | — | 2 / 1 / 0 entries visible | `DIM-1` |

Positive controls (prove the denials are surgical, not a deny-everything stub): `PC-1` member reads own timeline, `PC-2` member writes own entry, `PC-3` co-member reads published entry, `PC-4` author reads own draft — all ALLOW.

## 7. Fail-closed rules

1. **Default DENY.** Every branch of `evaluateAccess` that does not end in an explicit ALLOW denies with a reason code.
2. **Unknown data denies.** Unknown child, missing owning household, empty membership roster → `DENY_UNKNOWN_CHILD_SCOPE` / `DENY_NO_HOUSEHOLD_PATH`. Never "best effort".
3. **Decisions are values, not exceptions.** A thrown error at an enforcement point must be interpreted as DENY upstream; the pure policy never throws.
4. **Reason codes are contractual.** Tests pin `outcome` **and** `code` — a policy that denies for the *wrong* reason fails the suite.
5. **Attribution is server-bound.** `authorId` on a write is claimed, never trusted; it must equal the authenticated principal (`DENY_ATTRIBUTION_MISMATCH`).
6. **Events inherit entry visibility.** `Event[]` is readable only as widely as its parent entry (`AB-10`) — no side-channel around drafts.

## 8. Contract gaps & required extensions (proposals, not schema claims)

Contract v0.1 defines Entry + Event only. The following are **required** to enforce this model and are proposed for the contract thread (rule 2: propose before adding) — they are NOT part of the current schema and nothing in this PR claims otherwise:

1. **Child scope on every resource** — `childId` + owning `householdId` on child profiles, entries, and events (or a scoping envelope around them). Without it, B1/B2 are unenforceable.
2. **Household roster entity** — explicit membership records (household ↔ caregiver). Membership must be a fact the server maintains, not something derivable from content.
3. **Server-bound attribution** — `Entry.authorId` / `Event.authorId` must be set from the authenticated session server-side; the client-proposed value is a claim to verify (`AB-9`).
4. **Audience dimension (future)** — an explicit audience-grant field on entries if/when per-entry audiences beyond the household are needed (dimension 2 extension). Kept OUT of v0.1 deliberately: the two-dimension rule requires the fields to be separable, not merged.

## 9. Enforcement wiring (what this PR does and does not deliver)

**Delivered here:** the model (this document), a pure fail-closed decision function ([`access/policy.ts`](./access/policy.ts)), and 17 executable named tests ([`access/policy.test.ts`](./access/policy.test.ts)).

**Not delivered here (owned by other lanes / future PRs):** the Convex mutation/query layer that calls `evaluateAccess` before any database read/write; the household roster storage; session→principal resolution; and the swap from the contract-shape mock to the real `packages/domain` schema. Until that wiring exists, `evaluateAccess` must be treated as the reference decision function — enforcement points call it, they do not re-derive policy.

## 10. Evidence

```
bun test ./security
  (pass) PC-1 … PC-4                      positive controls
  (pass) AB-1, AB-2, AB-3, AB-7, AB-7b    household-membership boundary
  (pass) AB-4, AB-10, DIM-1               publication-state boundary + composition
  (pass) AB-5, AB-6                       authentication edge
  (pass) AB-9                             attribution integrity
  (pass) AB-12, AB-12b                    fail-closed on missing data
  17 pass, 0 fail
```

Static checks: `tsc --strict --exactOptionalPropertyTypes` clean on `security/access/*.ts`.

Every test documents the exact assertion that denies access, as a comment pinning `outcome` and `code` (see §7 rule 4). Full run output is reproduced in the PR description.
