# Huckleberry Workflow Deep Research — Source-Linked Interaction Analysis & Applicable Design Patterns

> **Repo copy:** this document mirrors the workspace evidence artifact *"Huckleberry Deep Research — Source-Linked Interaction Analysis & Design Patterns"* (project prj_BIp9UTWX, artifact art_GNcjlpUu). Consumers: delivery-map slots 07 (source-preserving capture), 08 (semantic extraction), 10 (append-only corrections), 15 (read-only agent queries), 17 (resumable conversations), 21 (authored timeline), 24 (digest), 25 (trends), 26 (export). Contract-touching items are **[contract proposals]** for the contract owner (rule 2) — nothing here changes the schema unilaterally.

**Date of research:** September 17, 2026 · **Method:** live crawls of the official Huckleberry Labs help center (huckleberry.zendesk.com), live fetches of both store listings, plus targeted search-index snippets where noted. Every claim names its source; every gap is marked **UNKNOWN** rather than assumed absent. No medical claims are made or implied.

**Load-bearing assumption:** the brief presumes that a market-leading tracker's *documented* workflows transfer as design input for a family-group journal. That holds for capture/correction/retrieval mechanics. It does **not** hold for sharing: Huckleberry's documented model is one shared credential with no per-person identity, so nothing about multi-identity UX can be learned from it — attribution analogs come from elsewhere in our landscape research (Baby Connect, Qeepsake).

---

## 1. What the product is (current state, verified this session)

Huckleberry (Huckleberry Labs Inc.) is an all-in-one baby/child tracker positioned in the iOS **Medical** category, "trusted by 5+ million families," with a free tier plus **Plus** ($11.99/mo tier shown) and **Premium** ($14.99/mo tier shown) memberships. Current release: App Store version v0.9.305 ("1d ago" at fetch); Play listing updated Aug 19, 2026.
Sources: App Store listing https://apps.apple.com/us/app/huckleberry-baby-tracker/id1169136078 · Play listing https://play.google.com/store/apps/details?id=com.huckleberry_labs.app&hl=en_US (both fetched Sept 17, 2026).

Tier placement of the features this brief cares about (both store listings, fetched live):
- **Free:** one-touch tracker for sleep/diapers/feedings/pumping/growth/milestones/weight/potty/activities/medicine, breastfeeding timer, sleep summaries/history/averages, multiple children with individual profiles, reminders, and — verbatim from both listings — "**Sync with multiple caregivers across devices**."
- **Plus:** everything free, plus SweetSpot® predictions, Schedule Creator, Insights, Enhanced Reports, and "**AI Logging: track your day through text, voice, or photo**."
- **Premium:** everything in Plus, plus **Berry** ("24/7 guidance with our expert-vetted AI chat") and Custom Sleep Plans.

Naming note: the live help center section is titled "**AI logging**" (section 38422211696531, crawled today); the same article IDs surface in the search index under "**AI chat**" titles dated Feb 2025. The feature was evidently renamed; current primary sources say AI logging.

## 2. Voice / text / photo capture — what the primary sources document

**One conversational surface, three input modalities.** "AI logging can use voice, text, or an image of a log sheet to make logging quick and easy." It is reached from a floating button on the home screen; the button can be hidden in Settings. Sources: "What is the AI logging feature?" https://huckleberry.zendesk.com/hc/en-us/articles/38422287914515-What-is-the-AI-logging-feature (live, "11 months ago updated"); "Where can I find the AI logging feature?" https://huckleberry.zendesk.com/hc/en-us/articles/38422482564883 (search-index snippet only — body not retrieved live).

**Catch-up and multi-category utterances are explicitly supported,** with vendor examples: "Log pee diapers at 9, 11, 1, and 3 today" and "Log a 5 ounce bottle 10 minutes ago and she just had a pee diaper." Source: same "What is the AI logging feature?" article (live).

**Extraction targets a closed, narrow category set: "sleep, nursing, bottles, diapers and pumping."** Five categories only — the highest-frequency, lowest-risk types. The broader manual taxonomy is much wider (sleep, feeding, solids, diaper, potty, pumping, medicine, growth, temperature, eight sub-activities, contractions), and custom activity types are explicitly not supported: "We currently don't support being able to add your own activity to track." Sources: "What is the AI logging feature?" (live); "What other events can I track in the app besides sleep?" https://huckleberry.zendesk.com/hc/en-us/articles/4533227079315 (live; also states "Any event that you log will also appear in your calendar view and charts"); "I don't see an activity I want to track, can I add my own?" https://huckleberry.zendesk.com/hc/en-us/articles/4968861861267 (live).

**Photo capture is cross-source ingestion:** "a screenshot, or photo of a note (like from your daycare app, or your mom's handwritten note)," added via a "+" control that opens camera or gallery, then "ask it to add the logs." Text can be "type or paste text… (like if your mom sends you a text or email about bottles)." Sources: "How do I upload an image in AI logging?" https://huckleberry.zendesk.com/hc/en-us/articles/43377273904787 (live); "What is the AI logging feature?" (live).

**Voice UX mechanics (documented):** an animation shows when the feature is listening and "it stops receiving input after you stop talking" (endpoint-on-silence); spoken responses default to **muted** — "in case your baby is sleeping when you first open it" — and the mute setting is remembered. Sources: https://huckleberry.zendesk.com/hc/en-us/articles/38422926588051 and https://huckleberry.zendesk.com/hc/en-us/articles/38422903959443 (both live).

**Interaction flow detail (search-index snippet, Feb 2025 — not live-verified):** tap the floating button; "type into the message bar, tap the microphone to speak, or choose one of the options we show." Source: "How do I use the AI chat?" https://huckleberry.zendesk.com/hc/en-us/articles/38422753657491. Whether suggested-option chips exist in the current build: **UNKNOWN** (body not retrieved live).

**Second, separate voice path — Siri to a fixed vocabulary:** "Now you can log potty, diaper, nursing, bottle, and pumping with Siri," implemented through user-built iOS Shortcuts. Source: "Siri Voice Commands" https://huckleberry.zendesk.com/hc/en-us/articles/27299831807251 (search-index snippet — body not retrieved live). This is dictation to a fixed taxonomy, not free-form narrative extraction.

**Backdated capture is a first-class path** in the manual flow: "Set time" pickers for start and end, "Resume" for a session still in progress. Source: "How do I log a sleep session in the past, or one that started 10 minutes ago?" https://huckleberry.zendesk.com/hc/en-us/articles/360025521614 (live).

**UNKNOWN (capture):** whether transcription/extraction runs on-device or server-side; whether audio is retained; whether photo originals are retained. The help center documents Berry chat privacy (below) but documents no equivalent for AI-logging audio/images. Not found in reviewed sources.

## 3. Corrections — what the primary sources document

**Manual corrections route through the read surface, not the capture surface:** to edit or delete a saved sleep session, "tap on Reports… tap on the sleep session you want to edit… Tap the details section with the '>' for Edit and Delete options," also available from List view; editing adjusts Start/End times via time picker "and you can also change the sleep details." Source: "How do I edit or delete a sleep session?" https://huckleberry.zendesk.com/hc/en-us/articles/360025561494 (live).

**Corrections and backdated logs propagate to derived guidance:** "Once night sleep is retroactively added, SweetSpot recommendations will update accordingly." And the docs openly acknowledge staleness in the other direction: "If a nap was missed, SweetSpot can't update until you log the next nap." Source: "Why am I getting nap recommendations before my day start time?" https://huckleberry.zendesk.com/hc/en-us/articles/5139089389843 (live).

**AI-memory correction is conversational and manual:** Berry "doesn't know when a fact is no longer current. You can easily update what Berry knows by telling it the updated information or correcting Berry when it's using outdated information." Deletion of Berry memory/history is a **support-ticket request**, not self-serve. Source: "Berry - Memory and chat history" https://huckleberry.zendesk.com/hc/en-us/articles/46601880952211 (live).

**UNKNOWN (corrections):** whether AI-created logs can be edited through the same Reports path (not documented); whether any edit history, audit trail, or before/after lineage is kept anywhere (not documented); whether deleting a session that fed a sleep plan invalidates the plan's analysis (not documented).

## 4. Retrieval — what the primary sources document

Four distinct read modes, with a clean split between *data* retrieval and *guidance* retrieval:

1. **Conversational data queries inside AI logging:** it "can also let you know your next SweetSpot®, or tell you about recent logs (as in, 'When was her last wet diaper' for when you're on the phone with the doctor)." Source: "What is the AI logging feature?" (live). Corroborating (snippet, Feb 2025): "It can also tell you about things it recently logged, or when your next SweetSpot® is coming" — https://huckleberry.zendesk.com/hc/en-us/articles/38423050280979.
2. **Charts/list/summary (Reports):** all tiers get basic day/week charts, list view, and summary; Plus/Premium add Enhanced Reports (Wake Window vs SweetSpot, Rise and Bedtime, solids "most loved"/allergens). Sources: https://huckleberry.zendesk.com/hc/en-us/articles/46453238820115 (live).
3. **Calendar view:** every logged event appears in calendar view and charts (taxonomy article, live).
4. **Berry guidance chat (Premium):** answers from expert-vetted AI plus what you tell it and its memory — the docs do **not** document Berry querying the event log. Source: "What is Huckleberry Premium?" https://huckleberry.zendesk.com/hc/en-us/articles/46113360341395 (live); Berry memory article (live).

**Retention of AI conversations is short and disclosed:** "Chat history is the visual display of your past messages and shows the last 12 hrs of conversations." Memory is separate, persists across sessions/devices, and "also users, if you share an account." Source: Berry memory article (live). Per-child chat histories within AI logging (tap the child icon or name the child) — search-index snippet, Feb 2025, https://huckleberry.zendesk.com/hc/en-us/articles/38423123386003; the 12-hour window itself is live-confirmed by the Berry article.

**Read preferences are per-device, not per-account:** report category filters and time periods, "if you track across multiple devices, the settings are saved per device." Source: https://huckleberry.zendesk.com/hc/en-us/articles/4409238549907 (live). Day-boundary semantics are configurable per child ("day start"), and day/week totals count against that boundary so night sleep lands on one day. Sources: https://huckleberry.zendesk.com/hc/en-us/articles/22939103913363 (live).

**Export:** per-child CSV of "all your logged data… including sleep, feeding, diaper, etc.," delivered as an emailed download link valid 24 hours. Source: "Can I export my data from the app?" https://huckleberry.zendesk.com/hc/en-us/articles/5055945148819 (live). On subscription cancel, data is retained and free features keep working (https://huckleberry.zendesk.com/hc/en-us/articles/4414413611027, live). Account deletion is permanent, confirmed by typing the full name, and the docs steer users to export first (https://huckleberry.zendesk.com/hc/en-us/articles/4409224053395, live). Child-profile deletion likewise requires typing the child's name and "cannot be recovered" (https://huckleberry.zendesk.com/hc/en-us/articles/360055234773, live).

**UNKNOWN (retrieval):** whether conversational queries over older data (beyond "recent logs") exist; how far back "recent" reaches; whether query answers cite or link to underlying log entries. Not documented in reviewed sources.

## 5. Caregiver sharing — what the primary sources document

**The documented model is one shared credential, not separate identities.** "Currently the way to share the app with a partner so multiple people can log data across devices is to log in with your account on your husband/wife/partner's phone," with sync "as long as both devices are connected to the Internet" — and documented failure conditions: unsupported OS versions, low-power mode, or disabled Background App Refresh "may prevent the app from synchronizing." Source: "How do I share my account with my husband/wife/partner or another caregiver?" https://huckleberry.zendesk.com/hc/en-us/articles/360062801213 (live; updated September 20, 2022).

**Concurrent multi-caregiver logging on one child is supported through that shared login:** "when your nanny logs naps, you will be able to see those sleep logs while you're at work. One parent can start a sleep session, and the other can stop it. Both caregivers must be connected to the internet in order to synchronize across devices." Source: "Can another caregiver track sleep for the same child?" https://huckleberry.zendesk.com/hc/en-us/articles/360025562694 (live; updated September 4, 2019).

**Sharing setup is credential mechanics:** AppleID/Facebook signups add an email+password login so the partner can use the same account (https://huckleberry.zendesk.com/hc/en-us/articles/4409238573075, live); login troubleshooting says "If you share an account with your partner, try logging in with your partner's email address" (https://huckleberry.zendesk.com/hc/en-us/articles/360063120573, live). Reminders and widgets sync across any device logged into the account (https://huckleberry.zendesk.com/hc/en-us/articles/360051426873, live).

**No per-person attribution, roles, or per-entry audience appear anywhere in the reviewed sources.** Every logged event belongs to "the account." The AI's memory deliberately spans the humans behind the shared login ("persists across sessions and devices (also users, if you share an account)" — Berry memory article, live), meaning one caregiver's stated preferences and corrections shape the other's AI context. **UNKNOWN:** whether any attribution or role capability exists in the product outside these sources — absence unverified; the reviewed docs are the complete public record we found.

**The only documented outside-viewer mechanism is out-of-band:** parents "can opt to grant [Baby Sleep Science, a partner service] access to view your Huckleberry sleep logs and history" (https://huckleberry.zendesk.com/hc/en-us/articles/360025708713, live) — granted externally to the other service, not managed as an in-app identity.

**Privacy labels (both fetched live):** App Store: data **linked to identity** includes Health & Fitness, User Content, Contact Info, Identifiers, Usage Data, Diagnostics; Play data-safety: collects personal info, photos and videos "and 3 others," shares personal info and device IDs, transit-encrypted, deletion on request.

## 6. Applicable design patterns for Shared Child Journal

Each pattern is grounded in the findings above and mapped to the Effect v4 contract v0.2 (art_I2TCG08V) and the 30-slot delivery map (art_KyuMyDq3). Nothing here modifies the contract unilaterally — items marked **[contract proposal]** go to the contract owner for rule-2 review.

**P1 — One conversational capture surface, three modalities, one pipeline.** Huckleberry runs voice, typed/pasted text, and photo through a single chat-style surface with a single extraction behavior (validated at 5M+ families' scale on the paid tier). Our architecture already matches: Entry(transcript, events[], captureId, attempt) behind capture/extraction ops (PR #8/#9; slots 07–08). Keep voice/text/photo as modality variants of one op, not three features.

**P2 — Extraction aims at a deliberately narrow, closed category set.** Their AI logging covers five categories while the manual UI carries a dozen-plus, and custom types are refused outright. Our six-category closed union with schema-fail extraction (`EventsFailedSchema`) is the same bet. Pattern: resist taxonomy growth in the extraction path; growth belongs in the manual typed-event UI first.

**P3 — Photo-of-a-log-sheet is the bridge for caregivers who never open the app.** Their examples are exactly our population: the daycare app screenshot, grandma's handwritten note, mom's text about bottles. For our invited-caregiver story, the pattern is: accept external artifacts, preserve them raw, and extract into typed events with provenance naming the medium and the accountable author (the parent who captured it). **[contract proposal]** Entry/attachment metadata recording source medium (voice-note, photo-of-note, pasted-text) — slot 07 owner to weigh; v0.2's `transcript` field covers text/voice but not medium provenance for photo sources.

**P4 — Corrections live on the record, reachable from the timeline — with lineage the original lacks.** Huckleberry edits/deletes from the Reports detail view; our slot 10 (append-only corrections) generalizes this into revisions that never destroy history. The documented absence of any edit trail in their product (UNKNOWN, §3) is an opportunity, not a template. Corrections should also invalidate downstream answers (slot 24 revision-invalidation; remember-and-retrieve area's correction-driven answer invalidation).

**P5 — Disclose staleness and coverage in derived reads.** Huckleberry documents both propagation (retroactive logs update SweetSpot) and its staleness limit (predictions frozen until the next log). Our slots 24 (digest with gap disclosure) and 25 (trends with coverage/missingness) should treat that honesty as table stakes: every derived read states what it covers and when it last changed.

**P6 — Per-person identity and attribution is the counter-design to the shared credential.** Their model produces: no attribution of who logged what, AI memory that crosses household members, and read preferences stranded per device. Our contract already carries `authorId` on both Entry and Event and resolves audience from household grants (v0.2's two-dimensions rule). Extend the lesson to read state: per-person preferences, never per-device. The Berry memory leak across users is the single sharpest documented argument for our identity model — cite it when reviewing slot 20's threat model.

**P7 — Time semantics deserve explicit settings.** Configurable day-start boundary (per child), retroactive time-pickers, and "Resume" for in-progress sessions are all documented UX. Our digest (slot 24) and trends (slot 25) need a day-boundary decision; **[contract proposal]** child-level dayStart config — owner to schedule; small but user-visible.

**P8 — Voice UX defaults: silent output, visible listening state, endpoint-on-silence, remembered settings.** Documented details worth copying verbatim in slots 08/17 and the A/B home candidates: spoken replies default OFF because the baby may be sleeping; the listening animation is explicit; the mute choice persists. This is context-aware modality, not a settings afterthought.

**P9 — Export and deletion as designed flows with confirmation friction.** Per-child CSV export via expiring (24h) emailed link; full-name typed confirmation for account deletion; typed child-name confirmation for profile deletion; export-first nudge before deletion. Direct inputs for slot 26 (authorized export) and deletion UX: per-child scoping and expiring-link delivery are documented patterns to adopt.

**P10 — Say the retention window out loud.** "Shows the last 12 hrs of conversations" is a plainly disclosed retention rule for the AI surface, with memory handled as a separate, deletable store. Our capture history and context envelope (slots 06/17) should state an explicit retention window in-product rather than leaving it implicit. **[contract proposal]** retention/expiry policy surfaced in the context envelope documentation — context-envelope owner decides scope.

## 7. Unknowns register (explicit, per brief)

| # | Unknown | What was checked |
|---|---|---|
| U1 | Whether AI-created logs can be edited, and whether any edit history/audit trail exists | Corrections article covers manual sessions only; no AI-log correction documentation found |
| U2 | Whether per-caregiver attribution or roles exist anywhere | All sharing/account articles reviewed; none mention it; absence unverified beyond those docs |
| U3 | On-device vs server transcription for AI logging; audio/image retention | No equivalent of the Berry privacy article exists for AI logging in reviewed sources |
| U4 | Whether AI logging works offline | Offline article (4499354970643) body not retrieved this session; title-only |
| U5 | Whether conversational queries reach older data, and whether answers cite entries | Only "recent logs" examples documented; citation behavior undocumented |
| U6 | Current existence of suggested-option chips in AI logging | "How do I use the AI chat?" body not retrieved live; Feb 2025 snippet only |
| U7 | Berry's underlying model/provider | Not disclosed in reviewed sources |
| U8 | Concurrent-edit conflict behavior across two devices | Sync-failure conditions documented; conflict resolution not |
| U9 | Scope changes in the AI chat → AI logging rename | Live titles differ from Feb 2025 slugs; no changelog found |

## 8. Source register

All accessed September 17, 2026. "Live" = full text crawled/fetched this session; "snippet" = search-index snippet, body not retrieved live.

**Help center (huckleberry.zendesk.com), live:** 38422287914515 (What is the AI logging feature?) · 43377273904787 (upload image) · 38422926588051 (listening state) · 38422903959443 (respond out loud) · 46601880952211 (Berry memory & chat history) · 360025561494 (edit/delete sleep) · 360025521614 (log in past) · 360025562694 (another caregiver tracks sleep) · 360062801213 (share account) · 4409238573075 (AppleID sharing) · 360063120573 (login troubleshooting) · 360051426873 (reminder sync) · 4533227079315 (event taxonomy) · 4533335684243 (modify categories) · 4968861861267 (no custom activities) · 46453238820115 (basic vs Enhanced Reports) · 4409238549907 (report filters, per-device) · 22939103913363 (day-start totals) · 5139089389843 (retroactive logs & SweetSpot) · 5055945148819 (CSV export) · 4414413611027 (data on cancel) · 4409224053395 (delete account) · 360055234773 (delete child profile) · 360025708713 (third-party expert access) · 46113360341395 (What is Premium/Berry) · 28263913356563 (What is Insights) · section 38422211696531 (AI logging, 10 articles) · section 1500000353521 (Account Management).

**Store listings, live:** https://apps.apple.com/us/app/huckleberry-baby-tracker/id1169136078 (v0.9.305) · https://play.google.com/store/apps/details?id=com.huckleberry_labs.app&hl=en_US (Aug 19, 2026).

**Snippet-only:** 38422753657491 (How do I use the AI chat?) · 38423050280979 (What can the AI chat log?) · 38423123386003 (switch children in AI chat) · 38422482564883 (Where can I find the AI chat?) · 27299831807251 (Siri Voice Commands) · 4499354970643 (offline — title only).

**Relation to prior research:** extends art_iqwZCAsV §5 (Huckleberry/Baby Connect comparison) with corrections flow detail, Berry memory semantics, export/deletion flows, per-device read preferences, day-boundary semantics, sync-failure modes, and the AI chat → AI logging rename. No finding here contradicts rev. 2 of that document.
