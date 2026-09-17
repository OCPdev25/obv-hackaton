# Ported Thin-Path Deployment Evidence — reliable-panther-823 (PR #13)

Port of the retired thin-path functions (`children:create`, `entries:createEntry`,
`timeline:list` — retired in PR #5) onto the canonical four-table contract-derived
schema in `backend/convex`, via the tested Effect→Convex adapter
(`convexFields` + in-handler Effect decoding).

All smoke data is synthetic (`(synthetic)` names, `smoke_operator` author,
`cap-smoke-*` capture ids). Deployment: dev deployment `reliable-panther-823`.

## Step 0 — scope verification

`CONVEX_DEPLOY_KEY=... npx convex env list` →
`No environment variables set (on dev deployment reliable-panther-823)` — the key
scopes to the expected dev deployment before any write (same pattern as PR #5).

## Step 1 — clean slate

The old thin-path rows (Ada/Ben Test + 3 capture rows) predate the new schema and
would fail its validators. Cleared with confirmed empty replace-imports
(`convex import --table <t> --replace --yes --format=jsonLines empty.jsonl` for
`children` and `entries`), verified `There are no documents in this table.` on both.

## Step 2 — deploy

```
$ npx convex deploy
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

## Step 3 — synthetic smoke sequence

| # | Action | Result |
| --- | --- | --- |
| 1 | `households:create {"name":"Smoke Household (synthetic)"}` | `{"householdId":"jh75jh7wd3gwdfb0xsmycd53z18ekv5p","name":"Smoke Household (synthetic)","status":"created"}` — contract output shape |
| 2 | `children:create {"householdId":"jh75jh…ekv5p","name":"Ada Smoke (synthetic)","birthDate":1710460800000}` | `{"childId":"j973zajm5pdd7nfk65xk6shtkh8ekmxs","name":"Ada Smoke (synthetic)","status":"created"}` |
| 3 | `entries:createEntry {childId, authorId:"smoke_operator", rawTranscript:"Ada napped 45 minutes after lunch (smoke run).", captureId:"cap-smoke-001"}` | `{"status":"created","entryId":"j578w0863v9vwpk7ppetg0phm98ek37t","captureId":"cap-smoke-001"}` |
| 4 | **Idempotency (PR #5 semantic):** retry step 3 with the **same** `captureId:"cap-smoke-001"` and a **different** `rawTranscript` ("DIFFERENT PAYLOAD ON RETRY") | `{"status":"idempotent_hit","entryId":"j578w0863v9vwpk7ppetg0phm98ek37t","captureId":"cap-smoke-001"}` — **same entryId returned; original capture wins; retried payload change absorbed** |
| 5 | Second capture `captureId:"cap-smoke-002"` | `{"status":"created","entryId":"j57264zsw0s33pjjsmtr5tmb0x8ekdp7"}` |
| 6 | `timeline:list {childId}` | 2 entries, chronological (createdAt ascending), **contract shape**: rawTranscript verbatim, `extractionStatus:"pending"`, `structuredEventIds:[]`, `visibility:"draft"`, `captureId` present, **no `_id`/`_creationTime`** (read-boundary decode through `EntrySchema`) |
| 7 | **Negative:** `entries:createEntry` with `captureId:""` | `ConvexError {"code":"INVALID_ENTRY_INPUT","message":"Expected a value with a length of at least 1 at [\"captureId\"]"}` at the Effect decode boundary — **no entry written** |
| 8 | **Negative:** `children:create` with well-formed but nonexistent `householdId` | validator/existence error at `.householdId` (`v.id("households")`) — **no orphan child row created** (verified: 0 matching rows in `children`) |

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
`bd14805`: `pnpm turbo run typecheck test build` green (9/9 tasks),
`bun test ./security` 17/17, evaluation harness 6/6 + negative control fails as
expected. CI run on the same SHA: green.
