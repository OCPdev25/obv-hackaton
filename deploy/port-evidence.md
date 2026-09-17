# Ported Thin-Path Deployment Evidence — reliable-panther-823 (PR #13)

Port of the retired thin-path functions (`children:create`, `entries:createEntry`,
`timeline:list` — retired in PR #5) onto the canonical four-table contract-derived
schema in `backend/convex`, via the tested Effect→Convex adapter
(`convexFields` + in-handler Effect decoding).

Branch history (all synthetic-data work): `8f60912` port commit → `dd89f58`
evidence v1 → `643b786` test adaptations + **rebase onto master `00581f5`**
(the v0.3 contract fold, PR #14, merged mid-flight). This document reflects the
re-smoke run against the rebased head `643b786`.

All smoke data is synthetic (`(synthetic)` names, `smoke_operator` author,
`cap-smoke-*` capture ids). Deployment: dev deployment `reliable-panther-823`.

## Step 0 — scope verification

`CONVEX_DEPLOY_KEY=... npx convex env list` →
`No environment variables set (on dev deployment reliable-panther-823)` — the key
scopes to the expected dev deployment before any write (same pattern as PR #5).

## Step 1 — clean slate (run twice: pre-fold and post-rebase)

Rows predating a schema push that would fail its validators are cleared with
confirmed empty replace-imports
(`convex import --table <t> --replace --yes --format=jsonLines empty.jsonl`
for `entries`, `children`, `households`), verified
`There are no documents in this table.` / `Added 0 documents` per table.

## Step 2 — deploy

First deploy (port commit `bd14805`-era code):

```
✔ Deleted table indexes: entries.by_capture_id
✔ Added table indexes:
    children.by_household (householdId, _creationTime)
    entries.by_capture (captureId, _creationTime)
    entries.by_child (childId, _creationTime)
    entries.by_household (householdId, _creationTime)
    entries.by_child_createdAt (childId, createdAt, _creationTime)  ← clipped from
      captured output tail; proven live by the successful timeline:list query,
      which selects exactly this index (step 6)
✔ Deployed Convex functions to https://reliable-panther-823.convex.cloud
```

Redeploy after the v0.3 rebase (`643b786`): `✔ Deployed Convex functions to
https://reliable-panther-823.convex.cloud` — no index changes (additive only:
the v0.3 fold's optional `attachments` column reaches the schema through
`tableFrom(EntryFields)`; verified live in the adapter derivation, and the
regenerated `_generated` bindings are byte-identical to the committed ones).

## Step 3 — synthetic smoke sequence (final run at head `643b786`)

| # | Action | Result |
| --- | --- | --- |
| 1 | `households:create {"name":"Smoke Household (synthetic)"}` | `{"householdId":"jh730ybkv4vgxsxcd4nqjr2xk98ejk1j","name":"Smoke Household (synthetic)","status":"created"}` — contract output shape |
| 2 | `children:create {"householdId":"jh730yb…ek1j","name":"Ada Smoke (synthetic)","birthDate":1710460800000}` | `{"childId":"j97eq8zfd1fe3eqhs249q1qph58ekp0d","name":"Ada Smoke (synthetic)","status":"created"}` |
| 3 | `entries:createEntry {childId, authorId:"smoke_operator", rawTranscript:"Ada napped 45 minutes after lunch (smoke run).", captureId:"cap-smoke-001"}` | `{"status":"created","entryId":"j574pgm9hrd82sejwqjhd2vk198ejxpj","captureId":"cap-smoke-001"}` |
| 4 | **Idempotency (PR #5 semantic):** retry step 3 with the **same** `captureId:"cap-smoke-001"` and a **different** `rawTranscript` ("DIFFERENT PAYLOAD ON RETRY") | `{"status":"idempotent_hit","entryId":"j574pgm9hrd82sejwqjhd2vk198ejxpj","captureId":"cap-smoke-001"}` — **same entryId returned; original capture wins; retried payload change absorbed** |
| 5 | Second capture `captureId:"cap-smoke-002"` | `{"status":"created","entryId":"j575r0xd0ed4vj4vdbcypx4vz18ek9mp"}` |
| 6 | `timeline:list {childId}` | 2 entries, chronological (createdAt ascending), **contract shape**: rawTranscript verbatim (original transcript — not the retried payload — at the head of the timeline), `extractionStatus:"pending"`, `structuredEventIds:[]`, `visibility:"draft"`, `captureId` present, **no `_id`/`_creationTime`** (read-boundary decode through `EntrySchema`) |
| 7 | **Negative:** `entries:createEntry` with `captureId:""` | `ConvexError {"code":"INVALID_ENTRY_INPUT","message":"Expected a value with a length of at least 1 at [\"captureId\"]"}` at the Effect decode boundary (`convex/entries.ts:31`) — **no entry written** |
| 8 | **Negative:** `children:create` with well-formed but nonexistent `householdId` | validator/existence error at `.householdId` (`v.id("households")`) — **no orphan child row created** (verified: 0 matching rows in `children`) |

The identical sequence also passed on the pre-rebase port code (first deploy):
household `jh75jh7wd3gwdfb0xsmycd53z18ekv5p`, child `j973zajm5pdd7nfk65xk6shtkh8ekmxs`,
entries `j578w0863v9vwpk7ppetg0phm98ek37t` (deduped) / `j57264zsw0s33pjjsmtr5tmb0x8ekdp7`.

## v0.3 rebase notes

- PR #14 (contract v0.3 fold) merged at `00581f5` while this port was in flight.
  Rebased; the only textual conflict was the `entry.ts` import block — resolved to
  carry both the fold's `Attachment` import + `attachments` field and this port's
  `CaptureId` import + `captureId` field.
- The fold branded `CaptureId` (`Schema.NonEmptyString.pipe(Schema.brand(...))`).
  The adapter derives it as an optional `v.string()` validator (same pattern as
  the existing branded `convexId` types); domain test comparisons updated to
  decode branded values instead of plain string literals.

## Canonical-vs-thin-path divergence (deliberate)

- `createEntry` no longer accepts inline events (`captured_with_event_errors` in
  PR #5): the canonical model captures raw-first (`extractionStatus:"pending"`,
  `structuredEventIds:[]`) and event persistence belongs to the extractor via the
  `AppendEventsInput` contract (delivery-map slots 06/08).
- `timeline:list` output is `Array(EntrySchema)` — no embedded events, no `_tag`
  re-wrapping; events are reached through `structuredEventIds`.
- New beyond the three named functions: minimal `households:create` —
  `children:create` cannot be exercised without a household-creation path (no
  other write path for households exists in the deployed surface). Slot 19
  (actor/membership/invitation flow) supersedes it.

## Post-smoke state

Dev deployment left with only synthetic smoke rows: 1 household, 1 child, 2
entries (`cap-smoke-001` deduped, `cap-smoke-002`). Local verification at head
`643b786`: `pnpm turbo run typecheck test build` green (9/9 tasks),
`bun test ./security` 17/17, evaluation harness 6/6 + negative control fails as
expected. CI on the same SHA: green.
