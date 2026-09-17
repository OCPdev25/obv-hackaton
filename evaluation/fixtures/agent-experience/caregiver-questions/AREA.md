# Caregiver-Questions Fixture Area — Lane Descriptor

This is the caregiver-questions lane's fixture-area descriptor — it is **not** the
harness registration manifest (`evaluation/fixtures/manifest.json`, owned by the
PR #22 harness). This directory is intentionally UNREGISTERED: the corpus runner
only enumerates listed areas, and registration would additionally require the
harness to special-case a nested `manifest.json` (the area file filter excludes
only the root manifest path). If this area is ever registered, do it as
`scenario-and-authorization` / `bun-test-data`, and rename or absorb this file first.

Consumed directly by `packages/domain/test/careQuestion.test.ts` (fixtureDir URL) —
semantic validation and execution live with that suite, per the
`scenario-and-authorization` class contract.

```json
{
  "manifestVersion": "0.1.0",
  "description": "Caregiver-question lifecycle fixtures: questions attached to journal entries/events, answers, resolution/reopening, directed-vs-household addressing, handoff-digest inclusion, and the missing-vs-zero distinction. Decoded through the canonical Effect schemas on effect@4.0.0-rc.115; policy expectations evaluated against careQuestionPolicy.ts.",
  "contract": {
    "module": "packages/domain/src/careQuestion.ts",
    "effectPin": "4.0.0-rc.115",
    "proposesAgainst": "art_I2TCG08V (contract v0.2)"
  },
  "fixtures": [
    {
      "id": "FQ-HOUSEHOLD-A-LIFECYCLE",
      "file": "household-a.json",
      "kind": "success",
      "exercises": [
        "CareQuestion.attach.entry",
        "CareQuestion.attach.event",
        "CareQuestion.audienceKind.household",
        "CareQuestion.audienceKind.directed",
        "CareQuestion.handoffIncluded",
        "deriveQuestionState.open",
        "deriveQuestionState.answered",
        "deriveQuestionState.resolved",
        "deriveQuestionState.reopened",
        "buildHandoffDigest.explicit-negative",
        "buildHandoffDigest.excluded",
        "canViewQuestion.addressee-boundary",
        "canViewQuestion.draft-target",
        "canAskQuestion.roster-boundary",
        "canAskQuestion.draft-target"
      ]
    },
    {
      "id": "FQ-HOUSEHOLD-B-ISOLATION",
      "file": "household-b.json",
      "kind": "success",
      "exercises": [
        "canViewQuestion.household-boundary",
        "buildHandoffDigest.single-question"
      ]
    }
  ],
  "wireRules": [
    "timestamps are epoch-millis numbers (Contract v0.2 wire format)",
    "no explicit null anywhere \u2014 absent keys or optionalKey undefined only",
    "event-target questions always carry entryId AND eventId (invariant pinned by tests)",
    "all ids are 24-character synthetic stand-ins for Convex ids"
  ]
}
```
