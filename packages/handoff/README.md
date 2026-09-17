# @journal/handoff

Caregiver handoff prototypes for delivery slots 23/24: a **since-last-seen
summary** an invited caregiver can trust, in two interaction shapes built on the
same input model.

## What is here

| Shape | Entry point | What it is |
| --- | --- | --- |
| Static digest | `composeSinceLastSeen(input)` | A fixed, reviewable document: claims, routine context, unresolved questions, per-category coverage, gap disclosures, source index, suggested follow-ups. Pure and deterministic. |
| Interactive follow-up | `answerFollowUp(question, input)` | Caregiver asks; the answer is grounded in window captures or explicitly refused. Same `DigestInput`, same ground truth. |

`render.ts` renders either shape to plain text (what a ticket/print surface
would show).

## Hard rules (enforced, not documented)

- **Every claim links to its source.** `SourceRefs` is a `NonEmptyArray` — the
  shape cannot express an unsourced claim. Entry refs quote a verbatim
  transcript snippet; routine context cites the child profile.
- **No medical conclusions.** The digest reports what was logged, never what it
  means. There is no field for severity, comparison, or normality. Questions
  asking for medical judgment get `refused-medical`.
- **Absence of logs never reads as absence of care.** Days with zero captures
  are first-class `GapDisclosure` data with care-neutral wording
  ("a gap in the journal, not a gap in {child}'s care"). `assertCareNeutral`
  (word-anchored) rejects neglect-implying or interpreting vocabulary in all
  system-generated language. Verbatim human quotes are sources, not
  conclusions, and are deliberately not guarded.
- **Unpublished content never leaks.** Draft captures appear only as an
  unresolved question that cites the entry without quoting it; pending/failed
  extractions surface the same way — a summary never silently omits a capture
  it could not process.
- **Refuse rather than guess.** Follow-ups outside the window
  (`refused-out-of-window`) or asking for medical judgment (`refused-medical`)
  are explicit refusals. Low-confidence extractions are withheld from claims and
  escalated as questions.

## Window semantics

`[lastSeenAt, generatedAt)` in Unix ms, rendered in the caller's IANA timezone.
Entries at `generatedAt` are out; events at `lastSeenAt` are in.

## Fixtures and tests

`fixtures/*.json` are schema-checked acceptance fixtures (synthetic data only —
all ids are `syn-*`). `test/fixtures.test.ts` runs every fixture through the
composer and the follow-up surface and asserts expected claim counts, gap dates,
zero-coverage categories, question reasons, leak exclusions, rendered-content
invariants, and follow-up outcomes. `test/invariants.test.ts` covers the
structural rules above directly.

Regenerate fixtures after editing `scripts/gen-handoff-fixtures.mjs` (repo root):

```bash
node scripts/gen-handoff-fixtures.mjs
```

## Deliberate seams

- Authorization happened upstream (household/relationship grants); this package
  summarizes exactly what it is given. Slot 20 owns authorization, 23/24 own
  presentation.
- Question classification is deliberately heuristic keyword matching — the
  refusals, citations, and window semantics are the part meant to survive;
  the matcher is replaceable.
- No model call anywhere: the pipeline is deterministic so fixtures pin exact
  expected behavior.
