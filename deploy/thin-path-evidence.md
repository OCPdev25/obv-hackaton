# Thin-Path Deployment Evidence — dev deployment `reliable-panther-823`

> **What this is:** CLOUD DEV deployment evidence, produced with synthetic data via the
> Convex CLI (`npx convex run`). This is **not** live-LLM extraction, **not** a native
> device capture, and **not** browser app UI evidence.

- **Deployment:** `reliable-panther-823` (Convex dev deployment, created by Gil) — https://reliable-panther-823.convex.cloud
- **Repo / branch:** `OCPdev25/obv-hackaton` @ `deploy/thin-path` (cut from `origin/master @ 49224e0`)
- **Deployed code commit:** `94e706c` — `fix(convex): strip wire _tag discriminators at the storage boundary`
- **Contract source:** Shared Child Journal — Effect v4 Schema Contract v0.1 (project artifact `art_I2TCG08V`)
- **Pins:** `convex@1.46.0`, `effect@4.0.0-rc.115`
- **All command transcripts below are redacted** — the deploy key never appears in any output (verified by scan).

## Functions deployed (names + types)

| Function | Type | Purpose |
|---|---|---|
| `children:create` | mutation | Create a child (non-empty name, optional `birthDate` unix-ms) |
| `entries:createEntry` | mutation | Capture entry: raw transcript always preserved; extraction events decoded through the canonical Effect schema before storage; **idempotent on `captureId` retry** (original capture wins; retried payload changes are absorbed); validation failures return `captured_with_event_errors` and never block the capture |
| `timeline:list` | query | Per-child entries, chronological (oldest first) |

Storage: `entries` indexed by `captureId` (idempotency) and `[childId, createdAt]` (timeline).
Wire format per contract: unix-ms times, six category literals, confidence in [0,1],
explicit null rejected, empty `events` allowed.

## Finding F1 — contract mapping correction (deployment-verified)

The published contract's "Convex mapping" table maps `_tag` to `v.literal('Event')` for
storage. A real insert proves Convex rejects underscore-prefixed stored fields (reserved
for system fields like `_id`):

```
Uncaught Error: Document(value: {_tag: "Entry", ...}) isn't a valid document:
Field '_tag' starts with an underscore, which is only allowed for system fields like '_id'
```

(first deploy attempt, commit `960e9eb`; all three synthetic mutations failed identically
and rolled back — Convex mutations are atomic, so no partial state)

**Resolution:** `_tag` stays on the wire in both directions (createEntry args/events in,
timeline output out) and is stripped after `Schema.encodeSync(Entry)` before insert;
`timeline:list` re-wraps stored rows on read so returned objects decode through the
canonical schemas unchanged. Table + validator identity replaces the tag at rest.
The spike that authored the mapping table never executed a real insert — candidates
should fold this correction into their storage adapters.

## 0. Deployment-scope verification (before any write)

`CONVEX_DEPLOY_KEY=<stored key> npx convex env list`:

```
No environment variables set (on dev deployment reliable-panther-823)
```

Key scopes to the expected dev deployment — matches the verified fact; no mismatch. STOP
condition (different deployment / auth error) did not occur.

## 1. Deploy transcript

`CONVEX_DEPLOY_KEY=<stored key> npx convex deploy`:

```
▌ Deploying code to deployment:
▌ [Development] ocpdev25:ocean-finder:dev/ocpdev25 (dev) (dashboard: https://dashboard.convex.dev/t/ocpdev25/ocean-finder/reliable-panther-823)
▌ └─ https://reliable-panther-823.convex.cloud
- Deploying to https://reliable-panther-823.convex.cloud...

Convex AI files are not installed. Run npx convex ai-files install to get started or npx convex ai-files disable to hide this message.
✔ No indexes are deleted by this push
Uploading functions to Convex...
Generating TypeScript bindings...
Running TypeScript...
Pushing code to your Convex deployment...
Schema validation complete.
Finalizing push...
✔ Deployed Convex functions to https://reliable-panther-823.convex.cloud
```

## 2. Pre-deploy local contract smoke test (`npm run contract:smoke`, effect@4.0.0-rc.115)

```
decode ok — encoded back to wire: {"_tag":"Event","category":"potty","occurredAt":1726500000000,"quantity":{"value":2},"confidence":1,"authorId":"gil_test_operator","note":"morning, before preschool"}
absent optionals stripped: {"_tag":"Event","category":"meal","occurredAt":1726500100000,"confidence":0.5,"authorId":"gil_test_operator"}
category "nap" rejected: Expected "potty" | "meal" | "sleep" | "mood" | "milestone" | "school" |   at ["category"]
confidence 1.5 rejected: Expected a value between 0 and 1 |   at ["confidence"]
note null rejected: Expected string |   at ["note"]
occurredAt string rejected: Expected number |   at ["occurredAt"]
entry wire round-trip: {"_tag":"Entry","transcript":"raw dictated text stays verbatim","authorId":"gil_test_operator","createdAt":1726500200000,"status":"draft","events":[]}
```

## 3. Synthetic write→read (all data synthetic; operator id `gil_test_operator`)

### 3.1 Child A create

```
{ "childId": "j977jhkzj2gmv9q2ap82p5cpw58eky9e", "name": "Ada Test (synthetic)", "status": "created" }
```

### 3.2 First submit — `cap-001-synthetic` (published, 1 potty event)

```
{ "captureId": "cap-001-synthetic", "entryId": "j579t1x2pxcx6vdfn0gn41k4498ej10p", "eventCount": 1, "status": "created" }
```

### 3.3 Duplicate submit — same `captureId`, changed transcript and status (retry must be absorbed)

```
{ "captureId": "cap-001-synthetic", "entryId": "j579t1x2pxcx6vdfn0gn41k4498ej10p", "status": "idempotent_hit" }
```

Same `entryId` as 3.2 — the original capture wins; no second row, no second event.

### 3.4 Second entry — `cap-002-synthetic` (draft, 1 sleep event)

```
{ "captureId": "cap-002-synthetic", "entryId": "j578jzdkq72pgdghynd2ksncps8ekfp8", "eventCount": 1, "status": "created" }
```

### 3.5 Timeline for child A — **2 entries, not 3** (duplicate submit once → single event)

```
[
  {
    "_creationTime": 1789667121425.508,
    "_id": "j579t1x2pxcx6vdfn0gn41k4498ej10p",
    "_tag": "Entry",
    "authorId": "gil_test_operator",
    "captureId": "cap-001-synthetic",
    "childId": "j977jhkzj2gmv9q2ap82p5cpw58eky9e",
    "createdAt": 1789667121425,
    "events": [
      {
        "_tag": "Event",
        "authorId": "gil_test_operator",
        "category": "potty",
        "confidence": 1,
        "note": "morning, before preschool",
        "occurredAt": 1789633800000,
        "quantity": { "value": 2 }
      }
    ],
    "status": "published",
    "transcript": "Ada used the potty twice this morning before preschool!"
  },
  {
    "_creationTime": 1789667123975.888,
    "_id": "j578jzdkq72pgdghynd2ksncps8ekfp8",
    "_tag": "Entry",
    "authorId": "gil_test_operator",
    "captureId": "cap-002-synthetic",
    "childId": "j977jhkzj2gmv9q2ap82p5cpw58eky9e",
    "createdAt": 1789667123975,
    "events": [
      {
        "_tag": "Event",
        "authorId": "gil_test_operator",
        "category": "sleep",
        "confidence": 0.8,
        "note": "night sleep",
        "occurredAt": 1789628700000
      }
    ],
    "status": "draft",
    "transcript": "Slept through the night, woke up happy at 7."
  }
]
```

Note the read path: `_tag` discriminators re-wrapped, unix-ms wire times, absent
optionals absent (not null), transcripts verbatim — decodes through the canonical
schemas unchanged.

### 3.6 Child B create + validation-failure case (two contract-invalid events: `category: "nap"`, `confidence: 1.5`)

```
{ "childId": "j97e27cg5j26b1s72ks4r023qd8ekej9", "name": "Ben Test (synthetic)", "status": "created" }
```

```
{
  "entryId": "j57c9pwsws87h6h9vt6bkzh4258ej5st",
  "eventErrors": [
    {
      "error": "Expected \"potty\" | \"meal\" | \"sleep\" | \"mood\" | \"milestone\" | \"school\"\n  at [\"category\"]",
      "index": 0
    },
    {
      "error": "Expected a value between 0 and 1\n  at [\"confidence\"]",
      "index": 1
    }
  ],
  "rawPreserved": true,
  "status": "captured_with_event_errors"
}
```

Error returned per event with schema-precise messages; the capture itself was not blocked.

### 3.7 Timeline for child B — raw preserved, zero events

```
[
  {
    "_creationTime": 1789667153524.5132,
    "_id": "j57c9pwsws87h6h9vt6bkzh4258ej5st",
    "_tag": "Entry",
    "authorId": "gil_test_operator",
    "captureId": "cap-invalid-003",
    "childId": "j97e27cg5j26b1s72ks4r023qd8ekej9",
    "createdAt": 1789667153524,
    "events": [],
    "status": "draft",
    "transcript": "Nap happened at 1pm, she was out for two hours."
  }
]
```

## 4. Deviation from the contract text: import style

The contract shows `import { Schema } from 'effect/Schema'`. On `effect@4.0.0-rc.115`
the `effect/Schema` subpath exports its members directly (no named `Schema` export —
verified via node ESM/CJS probes), so the deployed code uses
`import * as Schema from 'effect/Schema'`. All combinators used are exactly the
contract's expressions (`Schema.Literals`, `Schema.TaggedStruct`, `Schema.DateFromMillis`,
`Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))`, `optional` /
`optionalKey`, `decodeUnknownSync`, `encodeSync`) and all decode/reject/encode behaviors
match the contract's rules.

## 5. Status labels

- Deployment: **CLOUD DEV** (`reliable-panther-823`), functions deployed and verified via CLI
- Data: **synthetic fixtures only** (`Ada Test (synthetic)`, `Ben Test (synthetic)`, `gil_test_operator`)
- NOT live-LLM extraction evidence
- NOT native device (iOS dictation) evidence
- NOT browser app UI evidence
