# Shared Child Journal — Operator Surface Design & Synthetic Fixture Spec (v0.2)

**Status:** Design only; implementation queues behind arena integration. Written against the Product & Architecture Blueprint (`art_mTQOKEoo`) and the Effect v4 Schema Contract v0.1 (`art_I2TCG08V`); error and lineage practice from the OpenCode findings (`art_pVC3BvZc`); capture vocabulary from the Foldkit findings (`art_TPkABBrX`) and the T3 dictation findings (`art_tXjksHOh`). v0.2 folds in Gil's scope clarification: the product serves a well-defined family group, and the context-envelope proposal (task `todo_AGnYA2P4`, project `prj_Vr9viFVG`) is assumed as an extraction input — integrated, not redesigned. Committed to branch `task/operator-surface-design-fixtures-raw-eve-EXGElnEN`.

**Load-bearing assumption.** The operator surface can be built against contract v0.1 plus additive, optional extensions, so everything proposed here stays decodable by v0.1 consumers. What confirms it: every v0.2 field in §4 is `optionalKey`, leaving existing decode paths untouched, and the fixtures in §6 validate against the published contract as-is. What breaks it: arena integration landing a capture model that separates raw capture from `Entry`, the context envelope publishing shapes that conflict with the integration points in §2 and §3, or the evaluation corpus harness defining a conflicting fixture format. Named once, plainly: the lineage data this design needs — attempt history, extractor/schema version per event — does not exist in contract v0.1. Section 4 is a proposal the contract owner must accept before any of it is buildable.

## 1. Scope: what the operator surface is

The blueprint settles the frame. The operator surface is the demo-scope admin screen to "browse entries, inspect extraction results, re-run extraction," and it is a first-class client: `apps/admin`, a web client pointed at the same Convex deployment as the mobile app. Three consequences follow.

No parallel API. The admin client imports the same generated `api` and the same `packages/contracts` schemas as the mobile app; every operator capability is a Convex query, mutation, or action in `packages/backend`. There is no direct database access and no service account that bypasses the authz layer.

The operator surface renders data, not logs. Failures appear as typed records — tagged errors in the OpenCode style: domain errors as `Schema.TaggedErrorClass` with an exported error union per service module, transport-agnostic, serialized into the record the view renders.

The split from the consumer app is in the client, not the backend. Both clients sit on the same tables and the same Effect contracts; the admin client trades fewest-decisions UX for raw access, per the blueprint's two-customer split.

Product scope, per Gil's clarification: this is a tool for a well-defined family group — mom, dad, and potentially invited caregivers — all known users with explicit context and permissions. Every member arrives by explicit invitation from an existing member and holds an explicit role grant. The operator surface designs for that world and nothing bigger: no onboarding flows, no billing surface, no provider marketplace, no anonymous or lobby states, and no cross-household access of any kind. Each operator surface belongs to exactly one household.

## 2. Operator views

### 2.1 Raw input inspector (byte-faithful)

Raw input is what capture produced before any structuring: the dictated transcript, the photo when attached, and — if retained — the audio recording (open question 3, §7). The inspector exists to answer one question without ambiguity: what exactly did the capture pipeline receive?

Byte-faithfulness rules, binding on the view:

- The transcript renders verbatim, in monospace: no trimming, no normalization, no reflow, no smart quotes. The panel displays byte length, UTF-8 SHA-256, and encoding alongside, with a copy-raw affordance.
- Photos are served as original bytes from Convex storage via the same query the app uses. Thumbnails are additive; the original is always reachable.
- Any derived value — resolved absolute times, normalized text — displays beside the raw value, labeled as derived, never in its place.
- Raw fields are immutable. The blueprint's rule holds: the transcript is never overwritten; edits re-run extraction, they do not revise history.

A metadata panel carries `captureId`, `authorId`, `createdAt` (wire format unix ms, displayed in household timezone), locale, device/os, and recording duration.

Context-envelope integration point (not a redesign): when the envelope proposal (task `todo_AGnYA2P4`) lands, the envelope travels with the capture as extraction input — raw utterance plus explicit refs (child, actor, view, timestamp-timezone, attachments, prior conversation), each field carrying provenance: user-assertion, app-known, or inferred. The inspector renders the envelope as a second panel: every field displayed with its provenance mark, and unknown rendered as explicitly unknown — "missing stays unknown" means the view never backfills a plausible default. The byte-faithful transcript and the envelope's raw utterance are the same bytes; the panel shows them once.

### 2.2 Extracted events view

Decode-through rule: the view renders only payloads that decode through the published `Event` schema (`Schema.decodeUnknownSync`). A payload that fails decode renders as "undecodable payload" with the decode error inline. The operator surface never hand-maps LLM output outside the schema — the contract's first rule ("decode through the schema; never hand-roll a second domain model") binds the admin client exactly as it binds the app.

Typed display: category (the six literals), `occurredAt` (wire unix ms; shown in household timezone with the raw ms beside it), `quantity` `{ value, unit? }` when present, `note` when present. Confidence renders as a badge using the contract's own semantics — 1 means caregiver-confirmed, lower means raw LLM guess — not a decimal to squint at.

Attribution: `authorId`, plus a lineage block per event — `attemptId`, `extractorVersion`, `schemaVersion`, `model`, `triggeredBy` (fields proposed in §4).

Two status axes, shown separately because they are different things: publication state (`draft | published`, carried by contract v0.1 `Entry.status`) and extraction status (`pending | structured | failed`, derived from the latest attempt per §4). Conflating these is the mistake this view is designed to prevent.

Context-envelope integration point: where an event consumed envelope context — the child ref, the actor, the timestamp-timezone used to resolve a relative phrase like "this morning" — the event's lineage block shows which envelope fields it used and each field's provenance (user-assertion vs app-known vs inferred). The operator can then tell a wrong-timezone bug from a wrong-assertion bug without leaving the view. Final field shapes belong to the envelope proposal.

### 2.3 Failures view

Two failure families, both already enumerated in earlier findings, surfaced as records.

Capture-side — the `VoiceTranscriber` error taxonomy from the T3 findings: `unavailable`, `unsupported-locale`, `preparation-failed`, `transcription-failed`, `cancelled`.

Extraction-side — the tagged error union the OpenCode findings prescribe for the extraction service: `ExtractionFailed` (with reason), `ValidationFailed`, `ProviderError`, `RateLimited`, `Timeout`, `EmptyTranscript`. Schema decode failures are their own category, because the decode error text — which names the failing field and path — is the single most useful payload an operator gets. It renders inline, not in a log.

Each failure row carries: `captureId`, `attemptId`, `occurredAt`, category, retryable flag, the serialized tagged error, and links to the raw input and the attempt history. Superseded attempts — stale results in the Foldkit vocabulary — remain visible and marked, never hidden.

Context-envelope integration point: once the envelope publishes its own error shapes, an envelope decode failure becomes a reason category in this union (a capture whose envelope does not decode is a distinct thing from one whose extraction failed). This design does not define that category; it reserves the slot and renders whatever tagged error the envelope proposal exports.

## 3. Rerun extraction with lineage

### 3.1 Lineage model

Every extraction run is an append-only `ExtractionAttempt` record (fields proposed in §4). One attempt is one run over one capture's raw input. Events produced by an attempt carry `producedBy: { attemptId, extractorVersion, schemaVersion }`, so any event traces to the exact run, code version, and contract version that produced it. `captureId` is the branded `EntryId` — the capture record's persisted identity; the Foldkit capture slice already keys in-flight work by `captureId`, and this design aliases the two names on purpose so the lanes share one vocabulary.

### 3.2 Rerun semantics

`rerunExtraction(captureId)` creates a new attempt over the same stored raw input. It never mutates stored events in place: the latest successful attempt's events become the entry's current events, and prior attempts stay fully inspectable.

Duplicate protection: if an attempt with the same `inputHash` + `extractorVersion` + `schemaVersion` already succeeded and is still current, rerun is a no-op unless `force: true`. `inputHash` is SHA-256 over the exact bytes fed to the extractor — once the envelope lands, that means the envelope bytes (which carry the raw utterance and its refs), not the transcript alone; hashing the transcript alone would miss an envelope-only correction such as a fixed timezone or child ref.

Diff between attempts: the view shows attempt N against N−1 — events added, events removed, and field-level changes (`category`, `occurredAt`, `quantity`, `confidence`, `note`). This is the direct answer to "what changed between attempts." When the envelope exists, the diff header also states which side of the input changed — envelope or raw utterance — so an operator reading "occurredAt moved four hours" knows whether the timezone ref changed or the extractor merely guessed differently.

Caregiver-confirmed events (`confidence = 1`) are pinned: a rerun never downgrades them. If a new attempt conflicts with a pinned event, the conflict displays and is resolved explicitly, not silently.

Editing an entry re-runs extraction over the stored transcript (a blueprint decision); that path records `triggeredBy: 'edit_reparse'` in the same history, and operator reruns record `operator_rerun`. The attempt history doubles as the audit trail (§5.4).

## 4. Contract v0.2 additions this design depends on (proposals)

Contract rule 2: "Adding fields: propose in this thread first; the schema is the single source of truth." This section is that proposal. All fields are additive; v0.1 decode behavior is unchanged. The context envelope is a separate, parallel proposal — owned by task `todo_AGnYA2P4` in project `prj_Vr9viFVG` — and joins the contract through its own acceptance; this table lists only what the operator surface itself needs.

| Proposal | Shape | Why the surface needs it |
|---|---|---|
| `ExtractionAttempt` (new tagged schema) | `_tag: 'ExtractionAttempt'`; `attemptId` (branded); `captureId` (EntryId brand); `attempt` (positive int); `startedAt`, `finishedAt` (DateFromMillis; `finishedAt` optional while running); `extractorVersion`, `schemaVersion` (NonEmptyString); `model` (optional); `triggeredBy: 'original' \| 'operator_rerun' \| 'edit_reparse'`; `inputHash` (NonEmptyString); `outcome: 'succeeded' \| 'failed'`; `failure` (optional tagged-error payload) | Attempt history, rerun idempotency, diff base |
| `Event.producedBy` | `optionalKey` struct `{ attemptId, extractorVersion, schemaVersion }` | Per-event attribution: which extractor/schema version produced each event |
| `Entry.attachments` | `optionalKey` array of `{ kind: 'audio' \| 'photo', storageId, sha256, bytes, mimeType }` | Byte-faithful raw inspector — v0.1 persists the transcript only, while the blueprint's entries sketch carries a photo ref |
| Extraction status | Derived, not stored: `pending` = no attempt; `structured` = latest attempt succeeded; `failed` = latest attempt failed | Avoids a second status enum drifting out of sync with the attempt record |
| `captureId` | Alias of branded `EntryId` (`Schema.brand`, per the OpenCode recommendation on single-value IDs) | Shared vocabulary with the capture slice |

## 5. Operator access model

### 5.1 Same contracts, same backend

The admin client consumes the identical backend surface as the mobile app: same Convex deployment, same generated `api`, same `packages/contracts` types, same household scoping enforced at the Convex layer. New operator-only functions (rerun, failure listing) live in `packages/backend` under the same contracts package — they are ordinary functions behind the same authz, not a side door.

### 5.2 Two separate dimensions

Publication state and audience permissions are different axes, and the distinction the brief asks to preserve lives here.

Audience permissions answer who is in the audience at all. Household membership is the root — the blueprint calls it "the access-control root for every read" — and every read is household-scoped at the Convex layer; the client is never trusted to filter.

Publication state answers where an entry is in its lifecycle: `draft | published` per entry (contract v0.1 `Entry.status`).

A draft entry is a lifecycle fact inside the household; audience permission is a membership fact. One does not imply the other: joining the household changes the audience, not the lifecycle; publishing changes the lifecycle, not the audience. The operator surface reads both through the same authz the app uses — no operator side channel, and no cross-household view at any scope.

### 5.3 Known members, explicit grants

The family group is small and known: mom, dad, and invited caregivers. Membership is created by explicit invitation from an existing member; permissions are explicit role grants — a parent role (full control, including rerun and correction) and a caregiver role (scoped write and read, per the blueprint's caregiver accounts) — never inferred, never mass-assigned. The operator role is one of these grants: it gates capabilities (rerun, failure inspection) and never widens scope. Because every member is a known person in a known household, there is no onboarding surface to design here — invitations and role assignment live in the consumer app's household management, and the operator surface inherits their results.

### 5.4 Audit

Operator reruns and corrections land in the attempt history via `triggeredBy: 'operator_rerun'`. No separate audit table for MVP — the lineage is the audit, and the auditor is the same household.

## 6. Synthetic fixture spec

`eval/corpus-harness` is not pushed as of September 17, 2026 — remote branches checked this session were `master`, `ci/pipeline`, `feat/vendor-agent-skills`, and `obvious/onboarding` — so this spec is self-contained and contract-mapped. It relocates to `evaluation/fixtures/` unchanged when the harness lands; the manifest is self-describing, so the move is mechanical.

### 6.1 Layout and manifest

```text
docs/design/fixtures/
  manifest.json
  captures/   # one JSON per fixture: raw input + expected outcome
  media/      # deterministic binary fixtures (photo/audio), if retained
```

```jsonc
// manifest.json
{
  "manifestVersion": "0.1.0",
  "contract": { "artifactId": "art_I2TCG08V", "version": "0.1", "module": "spikes/effect-compat/src/schema.ts", "effectPin": "4.0.0-rc.115" },
  "fixtures": [
    { "id": "F-HAPPY-POTTY-001", "file": "captures/F-HAPPY-POTTY-001.json", "kind": "success", "exercises": ["Event.category", "Event.occurredAt", "Event.confidence"] },
    { "id": "F-INVALID-QUANTITY-NULL", "file": "captures/F-INVALID-QUANTITY-NULL.json", "kind": "decode-failure", "expectCategory": "schema_decode" }
  ]
}
```

```jsonc
// captures/F-HAPPY-POTTY-001.json
{
  "fixtureId": "F-HAPPY-POTTY-001",
  "capture": {
    "captureId": "fx_happy_potty_001",
    "authorId": "fx_parent_a",
    "createdAt": 1758112800000,
    "locale": "en-US",
    "raw": {
      "transcript": "he went poop on the potty all by himself this morning!",
      "transcriptSha256": "<sha256-of-transcript-utf8>",
      "photo": { "file": "media/happy-potty-001.jpg", "sha256": "<sha256-of-fixture-bytes>", "bytes": 1, "mimeType": "image/jpeg" }
    }
  },
  "expected": {
    "attempts": [
      { "attemptId": "fx_att_001", "outcome": "succeeded", "extractorVersion": "0.1.0", "schemaVersion": "0.1", "triggeredBy": "original", "inputHash": "<sha256>" }
    ],
    "events": [
      { "_tag": "Event", "category": "potty", "occurredAt": 1758102000000, "confidence": 0.87, "authorId": "fx_parent_a", "producedBy": { "attemptId": "fx_att_001", "extractorVersion": "0.1.0", "schemaVersion": "0.1" } }
    ]
  }
}
```

### 6.2 Validation rules

1. Every `expected.events` payload decodes via `Schema.decodeUnknownSync(Event)` on the pinned `effect@4.0.0-rc.115`, imported from `effect/Schema` (JSON Schema, if needed, via `Schema.toJsonSchemaDocument` — the `effect/JSONSchema` module does not exist on this pin).
2. Every expected-failure fixture fails decode with the named category.
3. Transcripts round-trip byte-identical as UTF-8; binary fixtures are deterministic, generated once, with SHA-256 recorded in the manifest.
4. Wire format only: `_tag` literals present, timestamps as unix-ms numbers, and no explicit `null` where the contract says absent — the contract states explicitly that `quantity: null` is not in contract.

### 6.3 Fixture inventory

| Class | Fixtures | Contract rule exercised | Expected outcome |
|---|---|---|---|
| Happy path, one per category | `F-HAPPY-{POTTY,MEAL,SLEEP,MOOD,MILESTONE,SCHOOL}-001` (6) | `Event.category` literals; `occurredAt` unix ms | Decodes; event matches expected |
| Multi-event capture | `F-MULTI-EVENT-001` (1) | `Entry.events` array; ordering | Two-plus events decode; attribution intact |
| Quantity variants | `F-QTY-WITH-UNIT-001`, `F-QTY-NO-UNIT-001` (2) | `quantity {value, unit?}` | Unit absent = `undefined`, never `null` |
| Confidence extremes | `F-CONF-CONFIRMED-001` (1.0, caregiver-confirmed), `F-CONF-LOW-001` (0.12) (2) | `confidence` finite in [0,1]; pinning semantics (§3.2) | Decodes; badge renders confirmed vs guess |
| Note edge | `F-NOTE-PRESENT-001`, `F-NOTE-ABSENT-001` (2) | `optionalKey(NonEmptyString)` | Empty-string note must fail decode (own fixture: `F-INVALID-NOTE-EMPTY-001`) |
| Tag adapter | `F-TAG-MISSING-001` (1) | `_tag` required on wire; adapter wraps before decode | Adapter-wrapped payload decodes |
| Schema-invalid set | `F-INVALID-BAD-CATEGORY-001`, `F-INVALID-NO-OCCURRED-AT-001`, `F-INVALID-QUANTITY-NULL-001`, `F-INVALID-CONF-ABOVE-ONE-001`, `F-INVALID-TRANSCRIPT-EMPTY-001` (5) | Decode discipline; `NonEmptyString`; explicit `null` rejection | Fails decode with named category |
| Failure paths | `F-FAIL-{EXTRACTION,VALIDATION,PROVIDER,RATE,TIMEOUT,EMPTY}-001` (6) | §2.3 tagged error union | Failure record renders with correct category + retryable flag |
| Lineage / rerun | `F-LINEAGE-TWO-ATTEMPTS-001` (1) | §3.1–3.2; `producedBy`; supersession | Attempt 2 (newer extractor version) supersedes attempt 1; diff enumerates one category change, one added event, one removed event |
| Idempotent duplicate | `F-DUP-SUBMISSION-001` (1) | Rerun no-op on same inputHash + versions | Second submission is a no-op without `force` |
| Stale result | `F-STALE-SUPPRESSED-001` (1) | Stale-result suppression (Foldkit findings) | Superseded attempt visible and marked |

Total: 28 fixtures. Every fixture names its `captureId`, and transcripts deliberately include byte-level edge cases (trailing whitespace, emoji, mixed language, control characters, one 500-plus-word run-on) so the byte-faithful view has something honest to render.

### 6.4 Consistency with the evaluation corpus

The inventory above is a superset of what an extraction-accuracy corpus needs: it adds presentation and lineage fixtures (stale, duplicate, diff) that the harness may ignore. When `eval/corpus-harness` lands, `manifest.json` gains a `corpusRef` field mapping success-path fixtures into the harness's corpus; nothing else moves.

### 6.5 Envelope fixtures (deferred, not counted)

The 28 fixtures above stay valid as written: they map the raw input to the v0.1 contract, and the envelope joins additively as a sibling of `capture.raw`. Once the envelope proposal (task `todo_AGnYA2P4`) publishes, a fixture class lands alongside it — provenance variants (user-assertion vs app-known vs inferred per field), missing-stays-unknown cases, and one envelope-only-change lineage fixture (same raw utterance, corrected envelope; the diff must attribute the change to the envelope). These are named here so the envelope lane can see the demand; their shapes wait for the envelope's own spec.

## 7. Decided vs open

**Decided in this design** (binding unless the lead overrides):

1. The operator surface is `apps/admin` over the same Convex deployment and contracts — no parallel API, no direct DB access.
2. Three views: raw input inspector (byte-faithful, verbatim, hash-displayed), extracted events (decode-through, typed, attributed), failures (tagged-error records with reason categories, stale marked).
3. Lineage via append-only `ExtractionAttempt`; events carry `producedBy`; rerun supersedes rather than mutates; caregiver-confirmed events are pinned.
4. Rerun is idempotent on `inputHash` + extractor + schema version unless forced; once the envelope lands, `inputHash` covers envelope bytes.
5. Byte-faithfulness is a binding view rule: raw bytes stored and served unmodified; derived values labeled as derived.
6. Failure taxonomy: capture-side `VoiceTranscriber` categories + extraction-side tagged error union; decode failures are their own category; an envelope-decode slot is reserved for the envelope proposal's error shapes.
7. Fixtures: JSON + self-describing manifest, validated by decoding through the published schema on the pinned Effect version; failure fixtures must fail with their named category; envelope fixtures deferred to the envelope's publication.
8. Access model for a well-defined family group: household-scoped at Convex; membership by explicit invitation; explicit role grants (parent, caregiver, operator) that gate capabilities and never scope; publication state and audience permissions are separate dimensions; the attempt history is the audit trail.
9. Explicitly out of surface scope: onboarding flows, billing, provider marketplace, anonymous states, cross-household access.
10. The context envelope (parallel proposal, `todo_AGnYA2P4`, `prj_Vr9viFVG`) is assumed as extraction input where relevant; this design integrates it — provenance marks in the inspector, provenance-carrying event attribution, envelope-aware inputHash — and never redefines it.

**Open questions** (each with what resolves it):

1. §4 v0.2 contract additions — contract owner acceptance (rule 2). Blocks all lineage UI; nothing else in this design is blocked.
2. Draft-entry visibility semantics — contract v0.1 defines `status` but not who inside a household sees a draft. Blocks only the events view's status filter.
3. Audio retention — the blueprint keeps raw transcript plus photo ref; storing recording bytes buys transcription debugging at a privacy and storage cost. Blocks only the inspector's audio panel.
4. Envelope integration details — envelope error shapes and hash canonicalization are owned by the envelope proposal (not read this session; coordinated through Gil's directive only). When it publishes, the reserved slots in §2.1, §2.3, §3.2, and §6.5 take their final shapes.
5. Rerun configuration — fixed extractor config in demo scope versus model/prompt knobs for the operator workbench (the blueprint's "prototyping new extractions" is expanding-horizons scope).
6. SpeechTranscriber segment metadata (timings, alternatives) in the raw view — depends on what the native module returns; the T3 findings verified segment text only.
7. Fixture location — `docs/design/fixtures/` now, `evaluation/fixtures/` when the harness branch lands; resolved by that landing.

## 8. Artifact trail (read this session)

- `art_mTQOKEoo` — blueprint: operator-surface demo scope, data model sketch, boundary and capture invariants, decided/open lists.
- `art_I2TCG08V` — contract v0.1: `Entry`/`Event` fields, wire format, decode entry points, rules 1–3, effect pin.
- `art_pVC3BvZc` — OpenCode findings: tagged errors, branded IDs, single schema authority, extraction fake layer.
- `art_TPkABBrX` — Foldkit findings: `captureId` vocabulary, stale-result state, result messages.
- `art_tXjksHOh` — T3 dictation findings: record-then-transcribe, `VoiceTranscriber` error taxonomy, audio bytes path.
- Context-envelope proposal — **not read this session**; referenced per Gil's directive (task `todo_AGnYA2P4`, project `prj_Vr9viFVG`). Described here only as the directive describes it: raw utterance plus explicit refs, provenance levels, missing-stays-unknown.
- Repo `OCPdev25/obv-hackaton`: remote branches listed this session; `eval/corpus-harness` absent; no `evaluation/` directory on master.
