# Shared Child Journal — Baby Connect Workflow Deep Research (v1, source-linked)

> Workspace evidence artifact: `art_Urx8Irct` (canonical copy). This file is the in-repo copy for slot owners; update both if revising.

**Direct-assignment research, thread th_OKUN0jMX, September 17, 2026.** Companion to the Product Landscape Findings rev. 2 (`art_iqwZCAsV`), which grounds Baby Connect at landing-page depth. This document goes deeper on the five workflow areas Shared Child Journal (SCJ) is building: shared care logs, timelines, correction, reporting, and caregiver handoff. Grounding artifacts: blueprint `art_mTQOKEoo`, 30-slot delivery map `art_KyuMyDq3`, Effect v4 Schema Contract v0.2 (`art_I2TCG08V`), operator surface spec v0.2 (`art_rBKvvzIa`).

**BLUF.** Baby Connect's own sources confirm a mature version of four of the five workflow areas — separate-account caregiver linking against an authorized-caregiver list, a whole-action timeline whose ordering basis is an explicit setting, derived reports/charts over the same entry store, and CSV/HTML export — and document nothing at all about correction semantics, per-author attribution display, or access-level granularity. Its handoff surface is thin in Baby Connect itself but fully documented in Daily Connect, a sibling product from the same vendor (Seacloud Software LLC). Seven source-linked design patterns follow, mapped to delivery slots, with six unknowns registered and left unknown. No contract changes are proposed; the executable slice (this doc plus `packages/domain/test/baby-connect-patterns.test.ts`) is additive only, so nothing blocks on coordination. One factual delta — the merged repo schema omits the contract's per-event `authorId` — is posted directly to the contract owner for the lineage slots.

## Method and source map

All sources below are vendor-owned properties retrieved this session (September 17, 2026): a site crawl of `en.babyconnect.com` plus direct fetches of the two store listings and the Daily Connect help center. Store listings are vendor-authored copy — primary for feature claims, not for behavior. Daily Connect is a **separate product from the same vendor** (developer: Seacloud Software LLC, contact `support@dailyconnect.com` per the Google Play listing); evidence from it is labeled *sibling* throughout and never attributed to Baby Connect. Following the landscape doc's convention, a feature not found in the sources read is **[absence unverified]**, not evidence of absence.

| Source | URL | Accessed | Covers |
|---|---|---|---|
| Support / FAQ | https://en.babyconnect.com/support | 2026-09-17 | Caregiver linking, backdating, timeline ordering, sync cadence, no bulk import |
| Privacy Policy (updated 8/24/2025 per page) | https://en.babyconnect.com/privacy-policy | 2026-09-17 | Data sharing with authorized users, AI subprocessors, deletion consent rule |
| Reports page | https://en.babyconnect.com/reports | 2026-09-17 | Reports/timelines/charts, CSV/HTML export |
| App Store listing (v13.32) | https://apps.apple.com/us/app/baby-connect-newborn-tracker/id326574411 | 2026-09-17 | Real-time tracker, instant sync, reports, push, read-only tier |
| Google Play listing (updated Mar 16, 2026) | https://play.google.com/store/apps/details?id=com.seacloud.bc | 2026-09-17 | Coordination block, access levels, developer identity |
| Blog: "Meet Our New Logo" (dated Dec 11, year not stated) | https://en.babyconnect.com/blog/new-brand-identity | 2026-09-17 | Luma AI weekly summaries, Food Library |
| *Sibling* — Daily Connect: daily summary emails (modified Mar 25, no year shown) | https://support.dailyconnect.com/en/support/solutions/articles/48001148232-daily-summary-emails-sent-to-parents | 2026-09-17 | Digest contents, triggers, silence behavior |
| *Sibling* — Daily Connect: summary email setup (modified Aug 17, no year shown) | https://support.dailyconnect.com/en/support/solutions/articles/48001211235-how-to-set-up-summary-emails-using-the-mobile-app | 2026-09-17 | Digest trigger config, audience choice, manual HTML/CSV export |
| *Sibling* — Daily Connect: teacher edit/delete of parents' entries (modified Sep 10, 2024) | https://support.dailyconnect.com/en/support/solutions/articles/48001260439-active-or-inactive-teacher-ability-to-edit-and-delete-parents-entries | 2026-09-17 | Correction rights as a security setting |

## 1. Shared care logs

**Evidence.** The FAQ documents a multi-account model, not a shared login: "on the mobile App: tap on the child name … then on 'Add Parent/Caregiver' under the Caregivers section, then enter the new caregiver email," after which "Each account will then be linked to your child, and everybody will be able to view and enter information about your child" (https://en.babyconnect.com/support). The same page's sync-troubleshooting answer refers to an "authorized caregiver list of the child profile," and a separate answer states there is "No limit" on linked caregivers. The privacy policy states the automatic sharing rule plainly: "the information you enter in the application is automatically shared with others authorized users that are linked to your account (for instance via the children profiles). It includes your email, name, phone number and any information regarding the child" (https://en.babyconnect.com/privacy-policy). The Play listing adds "Customize access levels for different users" and "Leave notes for caregivers" (https://play.google.com/store/apps/details?id=com.seacloud.bc).

**Unknown.** Whether entries are displayed with per-author attribution — no source read shows who logged what. **[absence unverified]**. What the access levels actually differentiate — no source read enumerates them. **[absence unverified]**

**SCJ implication.** The multi-account-with-linking model validates the blueprint's household-as-access-root; Baby Connect leaves attribution undocumented, which is precisely where SCJ's design already commits (`Entry.authorId`, contract v0.2). SCJ should not treat attribution as differentiating *unless* the unknown resolves against us — the design claim is "we do it deliberately," not "nobody has it."

## 2. Timeline

**Evidence.** The reports page promises "reports, timelines of every action, and charts displaying everything from growth to sleep" (https://en.babyconnect.com/reports). The FAQ documents a real ordering decision: the "'entry time based on' settings … indicates whether the app should use the start time or the end time of an entry when showing it in the chronological list, and in the summary" — with a worked example where a 1:10–1:45 AM nursing session sorts before or after a 1:30 AM entry depending on the basis, in *both* the timeline and the summary ("Last nursing at 1:10AM" vs "Last nursing at 1:45AM") (https://en.babyconnect.com/support).

**SCJ implication.** Ordering is not an implementation detail; Baby Connect ships it as a user preference precisely because span entries (naps, nursing) collide with point entries. The merged repo schema has point-only `Event.timestamp` today, but sleep payloads with start/end are inevitable — and when they land, the timeline (slot 21) and the digest (slot 24) must agree on one basis, because the summary is a derived view over the same events. The pattern is "one explicit basis, applied everywhere," and it can be settled now, cheaply, as a household-level setting.

## 3. Correction

**Evidence (thin).** The FAQ documents *backdated creation* — "Can I create an entry for a previous time or a previous day? Yes, just tap on the date and time button" — but nothing about editing or deleting existing entries, who may correct whose entries, or whether history is preserved (https://en.babyconnect.com/support). **[absence unverified]** across every Baby Connect source read.

**Sibling evidence.** Daily Connect documents correction rights as an explicit security setting: "Your staff can be given or remove permission to edit or delete entries made by parents," via Childcare Settings → Security (https://support.dailyconnect.com/en/support/solutions/articles/48001260439-…, modified Sep 10, 2024). Same vendor, separate product — but it shows the vendor's own model: correction rights over *other people's* entries are grantable, revocable permissions, not hardcoded role properties.

**SCJ implication.** This is direct external support for the design SCJ already committed to twice: role grants gate the `correct` operation (slots 10, 20), and the operator spec's append-only `ExtractionAttempt` lineage keeps originals inspectable (`art_rBKvvzIa` §3). Baby Connect itself gives no model to copy here — the honest reading is that SCJ's correction design is being validated by the vendor's *other* product, not by Baby Connect, and the pattern test in this PR encodes the append-only property over the canonical schemas.

## 4. Reporting and export

**Evidence.** Reports/charts/summaries all read from the same entry store — the FAQ's ordering answer puts the summary in the same breath as the chronological list, both driven by entry times (https://en.babyconnect.com/support). The reports page: "you can customize and export CSV or HTML files via email" for pediatricians (https://en.babyconnect.com/reports). The App Store listing: "Comprehensive reports: Trends, charts, and weekly averages"; the Play listing: "Generate comprehensive feeding summaries … Create reports for pediatrician visits." The reports page also records a real export journey: a user exported sleep data and hand-knit a quilt of the child's first year of sleep — evidence the export is real data-out, not a screenshot. The sibling Daily Connect adds the on-demand shape: manual export with a selectable time period and format, "HTML (by hour/category) or CSV" (setup article, accessed 2026-09-17).

**SCJ implication.** Same-store derivation is the architecture SCJ already chose (landscape §8, digest-as-read-model). What the Baby Connect evidence adds: export needs *selection* (period, format, category grouping) — slot 26's "real authorized export" should treat period/format selection as the core requirement, and typed serialization alone doesn't deliver it.

## 5. Caregiver handoff

**Evidence (Baby Connect).** Handoff in Baby Connect is real-time and thin: instant sync across devices, push notifications for child-profile updates (privacy policy; App Store listing "Push notifications for real-time updates"), plus notes and messages between caregivers (Play listing "Leave notes for caregivers"). No daily-summary feature is documented in any Baby Connect source read. **[absence unverified]**

**Sibling evidence.** Daily Connect's daily summary email is the fullest handoff spec in the vendor's docs: it "include[s] all information saved during the day" plus "needed items for the next day" and "upcoming events" at the top, with photos attached; it can be triggered "when a sign-out event is saved or each day at a specific time," with audience choice ("parents and family only or all caregivers"); and "No daily email is sent if there was no entry saved during the day" (both Daily Connect articles, accessed 2026-09-17).

**SCJ implication.** Two design facts worth taking. First, handoff is two cadences, not one: real-time notification per event *and* a periodic digest — slots 23 and 24 are one feature family, not adjacent ones. Second, a deliberate divergence: Daily Connect treats a no-entry day as silence; SCJ's slot 24 commits to *gap disclosure* ("digest with gap disclosure + revision invalidation"). For a family group, an empty day should be stated, not implied — that divergence is a choice to keep, and the delivery map already encodes it.

## 6. Design patterns for SCJ (source-linked)

| # | Pattern | Evidence | SCJ mapping | Reverses if |
|---|---|---|---|---|
| P1 | **Attributed multi-account roster**: separate accounts per caregiver, linked to the child via an authorized list; attribution is first-class | FAQ caregiver-linking + privacy auto-sharing rule | `Entry.authorId` + household grants — slots 19, 20, 21 | New Baby Connect docs show per-author display; pattern remains valid, only the gap framing changes |
| P2 | **One ordering basis, applied everywhere**: timeline and summary share a start/end-time basis, exposed as a setting | FAQ "entry time based on" | Slots 21, 24; reference comparator ships in the PR test | None expected — it is a consistency requirement, not a feature bet |
| P3 | **Correction rights are explicit grants** over append-only lineage | *Sibling* Daily Connect Security checkbox; Baby Connect: unknown | `correct` + role grants; operator spec §3 lineage — slots 10, 20 | Contract v0.3 fold lands different semantics; pattern yields to the contract owner |
| P4 | **Handoff = two cadences + forward-looking items**: real-time push per event; periodic digest that includes "needed items / upcoming events," never silent on empty days | Baby Connect push + notifications; *sibling* digest contents; deliberate divergence on silence | Slots 23, 24 (one family) | If real-time proves sufficient for a 2–3 person household, digest degrades gracefully — it is a derived view, so the cost of reversal is low |
| P5 | **Reports/export as selection over the same store**: period, format, category grouping | Reports page CSV/HTML; *sibling* manual export | Slot 26 (selection UX), slot 25 (trends read from events) | None — architecture-level agreement with landscape §8 |
| P6 | **Documented AI boundary**: PII stripped before third-party AI ("we remove children's names, photos, birthdates … before processing"), user opt-out, subprocessor disclosure (OpenAI, Google) | Privacy policy AI section, updated 8/24/2025 | Slot 18 provider adapter; input to Gil's SOL research — mechanics only, per scope (no personal-subscription APIs in production) | Gil's SOL conclusions arrive; they own the provider decision, this is evidence about mechanics |
| P7 | **Joint data stewardship on deletion**: child-profile data survives account deletion unless caregivers active in the last 24 months consent | Privacy policy account-deletion section | Household-scoped lifecycle decisions — slots 19, 20; not MVP-blocking | None for MVP; matters when deletion UX is designed |

## 7. Unknowns register

| # | Unknown | Why it matters | What would resolve it |
|---|---|---|---|
| U1 | Whether Baby Connect shows per-author attribution to other caregivers | Calibrates the P1 gap claim | In-app documentation, vendor help center, or a hands-on trial |
| U2 | The actual set and granularity of "access levels" | Informs whether per-role capability gating is common or rare in the category | Same as U1 |
| U3 | Baby Connect edit/delete semantics (who, what history) | Would tell us whether append-only correction is a differentiator or table stakes | Same as U1 |
| U4 | Whether Baby Connect has draft/private per-entry states | Bears on the visibility-vs-audience two-dimension design | Same as U1 |
| U5 | Luma AI ship date and scope (blog dated "Dec 11," no year) | Timing of the vendor's AI-summary feature | Vendor release notes or store changelog |
| U6 | Whether Baby Connect exposes the summary-email and edit-permission features its sibling documents | Would upgrade P3/P4 from sibling evidence to direct evidence | Baby Connect-specific help pages or a trial |

Per the direct assignment: unsupported absence stays unknown. None of the six is load-bearing for any slot's *dependency structure* — they calibrate claims, they do not gate work.

## 8. Executable work (this PR)

Additive only — no schema, harness, or source changes, so no contract proposal is needed and no running slot collides:

- `docs/research/baby-connect-patterns.md` — this document.
- `packages/domain/test/baby-connect-patterns.test.ts` — the schema-level patterns as executable properties over the canonical `EventSchema`/`EntrySchema`: byte-faithful transcripts across a three-author synthetic day, attribution integrity, append-only correction (original entry byte-identical after correction, disjoint event ids), ordering-basis consistency between timeline and summary (reference comparator for slots 21/24 to lift), handoff-summary derivation that excludes drafts, and a type-level assertion that `Entry` carries no `audience` field and no fused `status` (the contract's two-dimension rule). Fixtures are synthetic (`fx_` author ids, no real names, no medical claims), transcripts preserved raw, every fixture comment cites its pattern's source.

## 9. Coordination statement

No contract changes are proposed, so nothing requires the contract owner's acceptance. One factual observation is posted directly on the contract artifact (`art_I2TCG08V`): contract v0.2 specifies `Event.authorId`, while the merged repo `EventSchema` (PR #9) carries attribution at `Entry` level only — the lineage slots (02, 10) should reconcile that delta when they land. This thread owns its bounded deliverable end to end and did not route through the main coordinator, per the direct assignment.
