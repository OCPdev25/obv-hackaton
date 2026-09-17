# @journal/capture-recovery

Interrupted-capture recovery for the Shared Child Journal: a pure, deterministic
state machine + truthful UI projection + replayable fixtures covering
**interruptions (call / app switch), backgrounding with process death, network
loss, and duplicate submission** — prototyped one-handed for mom, dad, and
invited caregivers.

Bounded direct-worker extension of the canonical contract
(`art_I2TCG08V` v0.2). It **imports** `CaptureId`, `AttemptNumber`, and
`ExtractionStatus` from `@journal/domain` and **modifies nothing** in the
existing domain, entry, event, extraction, ui, security, or evaluation
packages. Proposal target: fold into contract v0.3 if accepted.

## Why events, not states

Interruption, backgrounding, network loss, and duplicate submission are
**events**, not phases. The persisted state is always sufficient to resume, so
recovery is just rehydration — no special "recovering" phase, no re-processing.

## Phases (truthful by construction)

| Phase | Means | Can never mean |
| --- | --- | --- |
| `drafting` | capture in progress; raw transcript persisted on every change | — |
| `pending` | submit in flight; server outcome genuinely unknown | "sent" / "saved" |
| `saved` | server ack received for the current submission | optimistic |
| `failed` | explicit server rejection with a reason; raw transcript intact | network guess without a rejection |
| `discarded` | caregiver explicitly discarded; receipt kept, raw cleared | silent absence |

There is no optimistic `saving` phase. `saved` is reachable **only** through
`SubmitAccepted` (idempotent: a repeated accept returns the same state
object). During a network outage a pending capture stays `pending` — the
client never fabricates a failure or a save.

## Events

`TranscriptChanged{at,text}` · `Interrupted{at,kind: call|app-switch|background|process-death}` ·
`Resumed{at}` · `SubmitRequested{at,submissionId}` · `RetryRequested{at}` ·
`SubmitAccepted{at}` · `SubmitRejected{at,attempt,reason: network|server|unauthorized|invalid}` ·
`ExtractionResultArrived{at,attempt,outcome: structured|failed}` ·
`NetworkLost{at}` · `NetworkRestored{at}` · `DiscardRequested{at}`

The reducer is total: unexpected event/phase combinations are recorded as
bounded anomalies (cap 10) instead of throwing — a recovery path must never
crash the capture it is recovering. Timestamps come from events only, so
fixtures replay identically anywhere.

## Invariants (each pinned by a test)

1. **Raw-before-events** — only `TranscriptChanged` and an explicit
   `DiscardRequested` may touch `rawTranscript`; every other transition
   preserves it verbatim.
2. **Attempt monotonicity** — `attempt` never decreases (canonical envelope).
3. **Stable submission identity** — `submissionId` is assigned at first submit
   and reused across retries; a foreign id while active is an anomaly.
4. **No optimistic truth** — `saved` only via `SubmitAccepted`; duplicate
   submissions suppressed while pending AND after save.
5. **Stale-result suppression** — results/rejections with
   `attempt < current` are counted and discarded, never merged (contract
   v0.2 rule b).
6. **Discard leaves a receipt** — raw text cleared; the receipt (time,
   length, attempt, submissionId) survives, keeping a discarded capture a
   visible receipt rather than a missing log (missing-log vs zero-care).
7. **Audience stays out** — phases describe delivery of the capture, never
   who may see it; `Entry.visibility` (`draft|published`) remains the only
   per-entry publication state, and household grants remain the audience
   dimension (contract v0.2, two independent dimensions).

## One-handed truthful UI projection (`bannerFor`)

Every banner is **derived from persisted state** — never in-memory optimism.
Bottom-anchored (thumb reach), ≤ 2 actions, single 48pt primary target.

| Persisted state | Banner |
| --- | --- |
| `drafting` + interrupted | info — "Draft is safe on this device" / primary **Keep recording** |
| `pending` | info — "Sending…" / "Not saved to the journal yet. A copy stays on this device." |
| `pending` + network lost | warning — "Waiting for network" / no actions (nothing to truthfully tap) |
| `failed` network/server | warning — "Couldn't send — …" / **Try again** + **Discard** |
| `failed` unauthorized | warning — "Sign-in needed" / **Sign in & send** + **Discard** |
| `failed` invalid | warning — "Needs a fix before sending" / **Review** + **Discard** |
| `saved` | banner hidden; success chip "Saved to the journal" |
| `discarded` | neutral receipt — "Discarded — nothing was added to the journal" |

## Storage contract

Save-on-transition: the caller persists after **every** `reduce` (the reducer
itself is pure and does no I/O), so a process death at any instant loses
nothing. `CaptureStorage` exposes `load` (cold-start rehydration),
`listUnresolved` (drafting/pending/failed — the reconnect sweep reconciles
these by `submissionId`), and `listReceipts` (discarded — receipts, not
unresolved work). Durable adapters must read through `decodeStoredState`
(fail-closed decode before use).

## Fixture catalog (`fixtures/`, replayed by `test/recovery.test.ts`)

| # | Fixture | Scenario |
| --- | --- | --- |
| 01 | `interruption-mid-draft` | call interrupts; reload mid-draft; raw verbatim; completes → saved |
| 02 | `backgrounding-process-death` | background + process death; cold start rehydrates raw + attribution → saved |
| 03 | `network-loss-pending` | outage after submit; stays pending (no fabrication); ack after restore → saved |
| 04 | `failed-retry-success` | explicit rejection → failed; one-handed retry (same submissionId, attempt+1) → saved |
| 05 | `duplicate-submission` | double tap + late re-tap; 2 duplicates suppressed; duplicate ack idempotent |
| 06 | `stale-result` | superseded attempt-0 result suppressed, never merged; attempt-1 applies |
| 07 | `discard-receipt` | explicit discard; receipt survives reload; resurrection attempt is an anomaly |

```bash
# from the repo root
pnpm install
pnpm exec turbo run build typecheck test --filter=@journal/capture-recovery
```

## Ownership and handoff

This package is a **proposal, implemented as code**: state-transition
contracts + fixtures, ready to be consumed by the lanes that own the
integration.

- **Slot 22 — Offline capture / reconnect / concurrent contributions**
  (`todo_N1ukao5q`, Journal & Caregiver Coordination): adopt this machine as
  the capture-side recovery kernel; add the durable `CaptureStorage` adapter
  (AsyncStorage/SQLite) and the pending-reconciliation protocol.
- **Voice/photo capture slice (merged PR #8)**: wire RN app-lifecycle events
  to `Interrupted`/`Resumed`, the speech layer to `TranscriptChanged`, and
  the Convex mutation to `SubmitRequested`/`SubmitAccepted`/`SubmitRejected`.
- **Review-UX candidates (slots 11–13)**: `bannerFor`/`RecoveryBanner` is the
  projection contract to render; copy strings are pinned by tests.
- **Contract thread (`art_I2TCG08V`)**: propose folding the recovery state
  schema into contract v0.3 — no Entry/Event/field changes are required by
  this package.

## Known limitations (honest)

- No live React Native component is included: the on-screen banner rendering
  and the AsyncStorage adapter are deliberately left to the owning lanes
  (above); what ships here is the behavior contract they consume.
- Pending-reconciliation (resolving a `pending` capture against the server by
  `submissionId` after a cold start) is a named integration responsibility
  here, not an implemented Convex function — it belongs with slot 02's
  operation contracts and slot 22's implementation.
- Attachments (photo recovery, large blobs) are out of scope for this slice.
- The reducer trusts the caller to persist on transition; runtime enforcement
  belongs to the storage adapter integration.
