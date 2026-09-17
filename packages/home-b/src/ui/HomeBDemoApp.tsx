/**
 * Candidate B demo screen — "Today feed-first with persistent conversational
 * composer". One React Native screen, no navigation library:
 *
 *   - The feed is home: today's recorded events newest-first, with month
 *     navigation into the September 2026 history (day chips + counts).
 *   - The composer is docked at the bottom on every scroll position: type or
 *     press the mic. The mic is a SIMULATED-TRANSCRIPT voice demo (no device
 *     speech dependency) that runs the SAME pipeline as text — raw transcript
 *     -> extraction double -> proposed events on a draft.
 *   - Drafts render as review cards over the feed: edit type/child/time/
 *     amount/audience, remove, re-run extraction, then publish. Published
 *     events keep provenance (author, channel, capture id, raw source).
 *   - Event detail: byte-for-byte raw transcript, append-only lineage, and a
 *     correction form that never mutates the original event row.
 *   - Persona switcher (mom / dad / invited caregiver) demonstrates fail-closed
 *     authorization: Rosa sees no drafts and no parents-only entries, and
 *     read-only lookups never write.
 */
import { useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import type { ProposedEventPatch } from "../store.js"
import { CHILD_IRIS, CHILD_MILO, DEMO_MONTH, PERSONAS, principalOf, seedStore } from "../fixtures.js"
import { DEMO_NOW, HOUSEHOLD_TIMEZONE } from "../time.js"
import { VOICE_SAMPLE, buildStore } from "../testing.js"
import type { AudienceIntent, CaregiverPrincipal } from "../auth.js"
import type { FeedEventView, FeedFilter, HomeBStore } from "../store.js"
import { categoryIcon, categoryLabel, colors, radius, spacing } from "./theme.js"

type PersonaKey = "dana" | "gilbert" | "rosa"
type Category = NonNullable<ProposedEventPatch["category"]>

const PERSONA_KEYS: readonly PersonaKey[] = ["dana", "gilbert", "rosa"]
const PERSONA_LABEL: Record<PersonaKey, string> = {
  dana: "Dana · mom",
  gilbert: "Gilbert · dad",
  rosa: "Rosa · nana",
}
const CATEGORIES = ["meal", "sleep", "mood", "potty", "milestone", "school"] as const satisfies readonly Category[]
const CHILDREN: readonly { readonly id: string; readonly name: string }[] = [
  { id: CHILD_MILO, name: "Milo" },
  { id: CHILD_IRIS, name: "Iris" },
]
const STEPS_MINUTES = 15 * 60_000

const timeLabel = (ts: number): string => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: HOUSEHOLD_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(
    new Date(ts),
  )
  const hour = parts.find((p) => p.type === "hour")?.value ?? "?"
  const minute = parts.find((p) => p.type === "minute")?.value ?? "?"
  return `${hour}:${minute}`
}

const payloadLabel = (view: FeedEventView): string => {
  const payload = view.payload
  if (payload === undefined) return ""
  if (view.category === "sleep" && payload.minutes !== undefined) return ` · ${payload.minutes} min`
  if (view.category === "meal" && payload.ounces !== undefined) return ` · ${payload.ounces} oz`
  return ""
}

interface ChipProps {
  readonly label: string
  readonly selected?: boolean
  readonly onPress: () => void
}

function Chip({ label, selected = false, onPress }: ChipProps) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  )
}

interface BannerProps {
  readonly text: string
}

function Banner({ text }: BannerProps) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  )
}

interface EventCardProps {
  readonly view: FeedEventView
  readonly onOpen: (eventId: string) => void
}

function EventCard({ view, onOpen }: EventCardProps) {
  return (
    <Pressable onPress={() => onOpen(view.eventId)} style={styles.card}>
      <Text style={styles.cardTitle}>
        {categoryIcon(view.category)} {view.childName} · {categoryLabel(view.category)}
        {payloadLabel(view)} · {timeLabel(view.timestamp)}
      </Text>
      <Text style={styles.cardMeta}>
        by {view.authorName} · {view.channel === "voice" ? "🎙 voice" : "⌨️ text"} capture {view.captureId}
        {view.photoId !== undefined ? ` · 📷 ${view.photoId}` : ""}
      </Text>
      <Text style={styles.cardProvenance} numberOfLines={2}>
        raw: “{view.rawTranscript}”
      </Text>
      {view.hasLineage ? (
        <Text style={styles.lineageBadge}>corrected — original preserved (was{payloadLabel({ ...view, payload: view.correctedFrom }) || " no quantity"})</Text>
      ) : null}
    </Pressable>
  )
}

interface EditRowProps {
  readonly store: HomeBStore
  readonly principal: CaregiverPrincipal
  readonly entryId: string
  readonly view: FeedEventView
  readonly bump: () => void
  readonly setBanner: (text: string) => void
}

/** One proposed event on a draft, with the full inspect/correct control set. */
function EventEditRow({ store, principal, entryId, view, bump, setBanner }: EditRowProps) {
  const patch = (p: ProposedEventPatch): void => {
    const result = store.updateProposedEvent(principal, entryId, view.eventId, p)
    if (result._tag === "InvalidEvent") setBanner(`Schema rejected the edit: ${result.issues[0] ?? "unknown"}`)
    if (result._tag === "NotDraft") setBanner("This entry is published — use a correction from the event detail instead.")
    bump()
  }

  const stepQuantity = (delta: number): void => {
    if (view.category === "sleep") {
      const current = view.payload?.minutes ?? 45
      patch({ payload: { minutes: Math.max(5, current + delta * 5) } })
      return
    }
    if (view.category === "meal") {
      const current = view.payload?.ounces ?? 6
      patch({ payload: { ounces: Math.max(1, current + delta) } })
    }
  }

  const quantityLabel =
    view.category === "sleep" ? "min" : view.category === "meal" ? "oz" : undefined
  const quantityValue =
    quantityLabel === undefined ? undefined : view.category === "sleep" ? view.payload?.minutes : view.payload?.ounces

  return (
    <View style={styles.editRow}>
      <View style={styles.editRowHead}>
        <Text style={styles.editRowTitle}>
          {categoryIcon(view.category)} {view.childName} · {categoryLabel(view.category)} · {timeLabel(view.timestamp)}
          {quantityValue !== undefined ? ` · ${quantityValue} ${quantityLabel}` : ""}
        </Text>
        <Pressable onPress={() => {
          const result = store.removeProposedEvent(principal, entryId, view.eventId)
          if (result._tag === "Removed") bump()
        }}>
          <Text style={styles.removeText}>remove</Text>
        </Pressable>
      </View>

      <Text style={styles.controlLabel}>type</Text>
      <View style={styles.chipRow}>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={`${categoryIcon(c)} ${categoryLabel(c)}`} selected={view.category === c} onPress={() => patch({ category: c })} />
        ))}
      </View>

      <Text style={styles.controlLabel}>child</Text>
      <View style={styles.chipRow}>
        {CHILDREN.map((c) => (
          <Chip key={c.id} label={c.name} selected={view.childId === c.id} onPress={() => patch({ childId: c.id })} />
        ))}
      </View>

      <Text style={styles.controlLabel}>time</Text>
      <View style={styles.chipRow}>
        <Chip label="−15m" onPress={() => patch({ timestamp: view.timestamp - STEPS_MINUTES })} />
        <Chip label="+15m" onPress={() => patch({ timestamp: view.timestamp + STEPS_MINUTES })} />
      </View>

      {quantityLabel !== undefined ? (
        <>
          <Text style={styles.controlLabel}>amount</Text>
          <View style={styles.chipRow}>
            <Chip label="−" onPress={() => stepQuantity(-1)} />
            <Text style={styles.quantityValue}>{quantityValue} {quantityLabel}</Text>
            <Chip label="+" onPress={() => stepQuantity(1)} />
          </View>
        </>
      ) : null}
    </View>
  )
}

interface DraftCardProps {
  readonly store: HomeBStore
  readonly principal: CaregiverPrincipal
  readonly entryId: string
  readonly views: readonly FeedEventView[]
  readonly bump: () => void
  readonly setBanner: (text: string) => void
}

/** Review card over the feed: raw source + per-event edits + publish. */
function DraftCard({ store, principal, entryId, views, bump, setBanner }: DraftCardProps) {
  const audience: AudienceIntent = views[0]?.audience ?? "household"
  const raw = views[0]?.rawTranscript ?? ""
  const channel = views[0]?.channel ?? "text"
  const captureId = views[0]?.captureId ?? ""

  return (
    <View style={[styles.card, styles.cardDraft]}>
      <Text style={styles.draftTag}>DRAFT — review before publishing</Text>
      <Text style={styles.cardMeta}>
        {channel === "voice" ? "🎙 voice" : "⌨️ text"} capture {captureId}
      </Text>
      <Text style={styles.rawBlock}>“{raw}”</Text>

      {views.map((v) => (
        <EventEditRow key={v.eventId} store={store} principal={principal} entryId={entryId} view={v} bump={bump} setBanner={setBanner} />
      ))}

      <Text style={styles.controlLabel}>audience</Text>
      <View style={styles.chipRow}>
        <Chip label="Household (everyone)" selected={audience === "household"} onPress={() => {
          const result = store.setAudience(principal, entryId, "household")
          if (result._tag === "AudienceSet") bump()
          else setBanner("Audience change denied.")
        }} />
        <Chip label="Parents only" selected={audience === "parents"} onPress={() => {
          const result = store.setAudience(principal, entryId, "parents")
          if (result._tag === "AudienceSet") bump()
          else setBanner("Audience change denied — author or parent only.")
        }} />
      </View>

      <View style={styles.chipRow}>
        <Pressable style={styles.ghostButton} onPress={() => {
          const result = store.rerunExtraction(principal, captureId)
          if (result._tag === "Rerun") setBanner(`Re-ran extraction (attempt ${result.attempt}) — ${result.proposedEventIds.length} proposed, ${result.dropped.length} dropped.`)
          else setBanner(`Re-run not available (${result._tag}).`)
          bump()
        }}>
          <Text style={styles.ghostButtonText}>Re-run extraction</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => {
          const result = store.publishEntry(principal, entryId)
          if (result._tag === "Published") setBanner(`Published to ${result.audience === "parents" ? "parents only" : "the household"} — raw source preserved.`)
          else if (result._tag === "Denied") setBanner(`Publish denied: ${result.decision.code}`)
          else setBanner(`Publish not available (${result._tag}).`)
          bump()
        }}>
          <Text style={styles.primaryButtonText}>Publish</Text>
        </Pressable>
      </View>
    </View>
  )
}

interface DetailCardProps {
  readonly store: HomeBStore
  readonly principal: CaregiverPrincipal
  readonly eventId: string
  readonly bump: () => void
  readonly setBanner: (text: string) => void
  readonly onClose: () => void
}

/** Published-event source view: raw transcript + lineage + correction form. */
function DetailCard({ store, principal, eventId, bump, setBanner, onClose }: DetailCardProps) {
  const [amountText, setAmountText] = useState("")
  const [reasonText, setReasonText] = useState("")

  const result = store.getEventDetail(principal, eventId)
  if (result._tag !== "Detail") {
    return (
      <View style={[styles.card, styles.cardDetail]}>
        <Text style={styles.cardTitle}>Event unavailable ({result._tag}).</Text>
        <Pressable onPress={onClose}><Text style={styles.removeText}>close</Text></Pressable>
      </View>
    )
  }

  const { view, corrections } = result.detail
  const raw = store.getRawSource(principal, view.entryId)
  const quantityLabel = view.category === "sleep" ? "minutes" : view.category === "meal" ? "ounces" : undefined

  const appendCorrection = (): void => {
    if (quantityLabel === undefined) {
      setBanner("Corrections here change quantities; type/child/time corrections ship with the full review surface.")
      return
    }
    const amount = Number(amountText)
    if (!Number.isFinite(amount) || amount <= 0) {
      setBanner(`Enter a ${quantityLabel} number first.`)
      return
    }
    const correction = store.correctEvent(principal, {
      eventId,
      patch: quantityLabel === "minutes" ? { payload: { minutes: amount } } : { payload: { ounces: amount } },
      reason: reasonText.trim().length > 0 ? reasonText.trim() : "corrected from the source view",
    })
    if (correction._tag === "Corrected") {
      setBanner("Correction appended — the original event row is preserved in lineage.")
      setAmountText("")
      setReasonText("")
      bump()
    } else if (correction._tag === "InvalidEvent") {
      setBanner(`Schema rejected the correction: ${correction.issues[0] ?? "unknown"}`)
    } else {
      setBanner(`Correction not available (${correction._tag}).`)
    }
  }

  return (
    <View style={[styles.card, styles.cardDetail]}>
      <View style={styles.editRowHead}>
        <Text style={styles.cardTitle}>
          {categoryIcon(view.category)} {view.childName} · {categoryLabel(view.category)}
          {payloadLabel(view)} · {timeLabel(view.timestamp)}
        </Text>
        <Pressable onPress={onClose}><Text style={styles.removeText}>close</Text></Pressable>
      </View>
      <Text style={styles.cardMeta}>by {view.authorName} · capture {view.captureId} · audience {view.audience}</Text>

      <Text style={styles.controlLabel}>raw source (byte-for-byte)</Text>
      <Text style={styles.rawBlock}>{raw._tag === "RawSource" ? `“${raw.transcript}”` : "(unavailable)"}</Text>

      <Text style={styles.controlLabel}>lineage ({corrections.length})</Text>
      {corrections.length === 0 ? <Text style={styles.cardMeta}>No corrections yet.</Text> : null}
      {corrections.map((c) => (
        <Text key={c.correctionId} style={styles.lineageLine}>
          {timeLabel(c.correctedAt)} {c.correctedEvent.childId === view.childId ? "" : "child"} ·{" "}
          {c.priorEvent.payload?.minutes !== undefined ? `${c.priorEvent.payload.minutes} min` : c.priorEvent.payload?.ounces !== undefined ? `${c.priorEvent.payload.ounces} oz` : "—"}
          {" → "}
          {c.correctedEvent.payload?.minutes !== undefined ? `${c.correctedEvent.payload.minutes} min` : c.correctedEvent.payload?.ounces !== undefined ? `${c.correctedEvent.payload.ounces} oz` : "—"}
          {" — “"}{c.reason}{"”"} ({c.correctedBy})
        </Text>
      ))}

      {quantityLabel !== undefined ? (
        <>
          <Text style={styles.controlLabel}>append a correction ({quantityLabel})</Text>
          <View style={styles.chipRow}>
            <TextInput
              style={styles.smallInput}
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="number-pad"
              placeholder={quantityLabel === "minutes" ? "60" : "8"}
            />
            <TextInput
              style={[styles.smallInput, styles.reasonInput]}
              value={reasonText}
              onChangeText={setReasonText}
              placeholder="why (kept in lineage)"
            />
            <Pressable style={styles.primaryButton} onPress={appendCorrection}>
              <Text style={styles.primaryButtonText}>Correct</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  )
}

interface HomeBDemoAppProps {
  /** Demo label rendered in the header; the synthetic dataset is always Polanco. */
  readonly title?: string
}

/**
 * Candidate B home screen. All state lives in the store; React state only
 * tracks UI selections (persona, day, filters, forms). Every read goes
 * through the store's read-only lookups; every write is attributed to the
 * selected principal and re-renders via `bump`.
 */
export function HomeBDemoApp({ title = "Polanco Household" }: HomeBDemoAppProps) {
  const store = useMemo(() => {
    const s = buildStore()
    seedStore(s)
    return s
  }, [])
  const [rev, setRev] = useState(0)
  const bump = (): void => setRev((r) => r + 1)

  const [personaKey, setPersonaKey] = useState<PersonaKey>("dana")
  const principal = principalOf(PERSONAS[personaKey])
  const [text, setText] = useState("")
  const [voiceDemo, setVoiceDemo] = useState(false)
  const [focusChildId, setFocusChildId] = useState<string>(CHILD_MILO)
  const [childFilter, setChildFilter] = useState<string | undefined>(undefined)
  const [selectedDay, setSelectedDay] = useState<number>(16)
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(undefined)
  const [banner, setBanner] = useState<string | undefined>(undefined)
  const captureSeq = useRef(0)

  const feedFilter: FeedFilter = {
    day: { year: DEMO_MONTH.year, month: DEMO_MONTH.month, day: selectedDay },
    ...(childFilter !== undefined ? { childId: childFilter } : {}),
  }
  const feed = useMemo(() => store.getFeed(principal, feedFilter), [store, principal, rev, childFilter, selectedDay]) // eslint-disable-line react-hooks/exhaustive-deps
  const monthSummary = useMemo(() => store.getMonthSummary(principal, DEMO_MONTH.year, DEMO_MONTH.month), [store, principal, rev]) // eslint-disable-line react-hooks/exhaustive-deps
  const catchUp = useMemo(() => store.getCatchUp(principal), [store, principal, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const draftsByEntry = useMemo(() => {
    const map = new Map<string, FeedEventView[]>()
    if (feed._tag === "Feed") {
      for (const v of feed.drafts) {
        const list = map.get(v.entryId) ?? []
        list.push(v)
        map.set(v.entryId, list)
      }
    }
    return map
  }, [feed])

  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setBanner("Nothing to capture yet — type an update or press the mic.")
      return
    }
    captureSeq.current += 1
    const result = store.submitCapture(principal, {
      captureId: `cap-ui-${personaKey}-${captureSeq.current}`,
      transcript: trimmed,
      channel: voiceDemo ? "voice" : "text",
      capturedAt: DEMO_NOW,
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId,
    })
    if (result._tag === "Created") {
      setText("")
      setVoiceDemo(false)
      setBanner(`Captured — ${result.proposedEventIds.length} proposed event(s) waiting in the review card below.`)
      bump()
    } else if (result._tag === "IdempotentReplay") {
      setBanner("Duplicate capture id — the original was kept (idempotent replay).")
    } else if (result._tag === "Rejected") {
      setBanner(`Rejected: ${result.reason}`)
    } else {
      setBanner(`Capture denied: ${result.decision.code}`)
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSubtitle}>Today feed-first · candidate B</Text>
        <View style={styles.chipRow}>
          {PERSONA_KEYS.map((key) => (
            <Chip key={key} label={PERSONA_LABEL[key]} selected={personaKey === key} onPress={() => {
              setPersonaKey(key)
              setSelectedEventId(undefined)
              setBanner(undefined)
            }} />
          ))}
        </View>
        {personaKey === "rosa" ? (
          <Text style={styles.rosaHint}>Viewing as an invited caregiver — parents-only entries are hidden, and your writes are the same as any member's.</Text>
        ) : null}
      </View>

      {banner !== undefined ? <Banner text={banner} /> : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {catchUp._tag === "CatchUp" && catchUp.events.length > 0 ? (
          <View style={[styles.card, styles.cardCatchUp]}>
            <Text style={styles.catchUpTitle}>
              Since you were away ({catchUp.events.length} new event{catchUp.events.length === 1 ? "" : "s"})
            </Text>
            {catchUp.events.slice(0, 3).map((v) => (
              <Text key={v.eventId} style={styles.cardMeta}>
                {categoryIcon(v.category)} {v.childName} · {categoryLabel(v.category)} · Sep {wallDay(v.timestamp)}
              </Text>
            ))}
            <Pressable style={styles.ghostButton} onPress={() => {
              store.markSeen(principal, DEMO_NOW)
              setBanner("Caught up — the block clears until the next activity.")
              bump()
            }}>
              <Text style={styles.ghostButtonText}>Got it</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.monthNav}>
          <Text style={styles.monthNavLabel}>‹</Text>
          <Text style={styles.monthNavTitle}>September 2026</Text>
          <Text style={styles.monthNavLabel}>›</Text>
        </View>
        {monthSummary._tag === "MonthSummary" ? (
          <View style={styles.chipRow}>
            {monthSummary.days.map((d) => (
              <Chip key={d.day} label={`Sep ${d.day} · ${d.count}`} selected={selectedDay === d.day} onPress={() => setSelectedDay(d.day)} />
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Today · Sep {selectedDay}</Text>

        {feed._tag === "Denied" ? (
          <Banner text={`Feed denied (${feed.decision.code}) — fail-closed: ${feed.decision.detail}`} />
        ) : (
          <>
            {draftsByEntry.size > 0 ? (
              <>
                <Text style={styles.subsectionTitle}>Review ({draftsByEntry.size} draft{draftsByEntry.size === 1 ? "" : "s"})</Text>
                {[...draftsByEntry.entries()].map(([entryId, views]) => (
                  <DraftCard key={entryId} store={store} principal={principal} entryId={entryId} views={views} bump={bump} setBanner={setBanner} />
                ))}
              </>
            ) : (
              <Text style={styles.emptyLine}>No drafts waiting — captures appear here for review before publishing.</Text>
            )}

            {feed.published.length === 0 ? (
              <Text style={styles.emptyLine}>No published events for Sep {selectedDay} yet — capture something below.</Text>
            ) : (
              feed.published.map((v) => <EventCard key={v.eventId} view={v} onOpen={setSelectedEventId} />)
            )}
          </>
        )}

        {selectedEventId !== undefined ? (
          <DetailCard
            store={store}
            principal={principal}
            eventId={selectedEventId}
            bump={bump}
            setBanner={setBanner}
            onClose={() => setSelectedEventId(undefined)}
          />
        ) : null}
      </ScrollView>

      {/* Persistent conversational composer — docked on every screen state. */}
      <View style={styles.composer}>
        {voiceDemo ? <Text style={styles.voiceDemoTag}>🎙 voice demo — simulated transcript, same pipeline as text</Text> : null}
        <View style={styles.chipRow}>
          {CHILDREN.map((c) => (
            <Chip key={c.id} label={`focus: ${c.name}`} selected={focusChildId === c.id} onPress={() => setFocusChildId(c.id)} />
          ))}
          <Chip label="🎙 voice" selected={voiceDemo} onPress={() => {
            setText(VOICE_SAMPLE)
            setVoiceDemo(true)
            setBanner("Voice demo: the simulated transcript loads into the composer — press send to run the SAME capture pipeline.")
          }} />
        </View>
        <View style={styles.composerRow}>
          <TextInput
            style={styles.composerInput}
            value={text}
            onChangeText={(t) => {
              setText(t)
              if (voiceDemo) setVoiceDemo(false)
            }}
            multiline
            placeholder="What happened? e.g. “Milo ate scrambled eggs at 8, then a meltdown; Iris napped 45 minutes.”"
          />
          <Pressable style={styles.sendButton} onPress={submit}>
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

/** Household-local day-of-month for catch-up lines. */
const wallDay = (ts: number): number => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: HOUSEHOLD_TIMEZONE, day: "numeric" }).formatToParts(new Date(ts))
  return Number(parts.find((p) => p.type === "day")?.value ?? "?")
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: spacing.s, paddingHorizontal: spacing.l, paddingTop: spacing.xl },
  headerTitle: { color: colors.ink, fontSize: 22, fontWeight: "700" },
  headerSubtitle: { color: colors.inkFaint, fontSize: 12, marginBottom: spacing.s, marginTop: 2 },
  rosaHint: { color: colors.warn, fontSize: 11, marginTop: spacing.xs },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.m, paddingHorizontal: spacing.l },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", marginBottom: spacing.s, marginTop: spacing.m },
  subsectionTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: spacing.s, marginTop: spacing.s },
  monthNav: { alignItems: "center", flexDirection: "row", gap: spacing.m, justifyContent: "center", marginTop: spacing.s },
  monthNavTitle: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  monthNavLabel: { color: colors.inkFaint, fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.m,
    elevation: 1,
    marginBottom: spacing.s,
    padding: spacing.m,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardDraft: { borderLeftColor: colors.warn, borderLeftWidth: 3 },
  cardDetail: { borderLeftColor: colors.accent, borderLeftWidth: 3 },
  cardCatchUp: { backgroundColor: colors.accentSoft },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  cardMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  cardProvenance: { color: colors.inkFaint, fontSize: 11, fontStyle: "italic", marginTop: spacing.xs },
  draftTag: { color: colors.warn, fontSize: 11, fontWeight: "700", marginBottom: spacing.xs },
  catchUpTitle: { color: colors.ink, fontSize: 14, fontWeight: "700", marginBottom: spacing.xs },
  rawBlock: { backgroundColor: colors.chip, borderRadius: radius.s, color: colors.ink, fontSize: 12, marginTop: spacing.xs, padding: spacing.s },
  lineageBadge: { color: colors.ok, fontSize: 11, marginTop: spacing.xs },
  lineageLine: { color: colors.inkSoft, fontSize: 11, marginTop: 2 },
  editRow: { borderTopColor: colors.line, borderTopWidth: 1, marginTop: spacing.s, paddingTop: spacing.s },
  editRowHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  editRowTitle: { color: colors.ink, flex: 1, fontSize: 13, fontWeight: "600" },
  removeText: { color: colors.danger, fontSize: 12 },
  controlLabel: { color: colors.inkFaint, fontSize: 10, marginTop: spacing.s, textTransform: "uppercase" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: { backgroundColor: colors.chip, borderRadius: radius.l, paddingHorizontal: 10, paddingVertical: 5 },
  chipSelected: { backgroundColor: colors.accent },
  chipText: { color: colors.inkSoft, fontSize: 12 },
  chipTextSelected: { color: "#fff" },
  quantityValue: { color: colors.ink, fontSize: 13, paddingHorizontal: spacing.s, textAlignVertical: "center" },
  primaryButton: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.s, paddingHorizontal: spacing.l, paddingVertical: spacing.s },
  primaryButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  ghostButton: { alignItems: "center", backgroundColor: colors.chip, borderRadius: radius.s, paddingHorizontal: spacing.l, paddingVertical: spacing.s },
  ghostButtonText: { color: colors.ink, fontSize: 13, fontWeight: "500" },
  emptyLine: { color: colors.inkFaint, fontSize: 12, fontStyle: "italic", marginVertical: spacing.s },
  banner: { backgroundColor: colors.okSoft, borderRadius: radius.s, marginHorizontal: spacing.l, marginTop: spacing.s, padding: spacing.s },
  bannerText: { color: colors.ok, fontSize: 12 },
  composer: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingHorizontal: spacing.l,
    paddingTop: spacing.s,
  },
  voiceDemoTag: { color: colors.warn, fontSize: 11, marginBottom: spacing.xs },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: spacing.s, paddingBottom: spacing.l, paddingTop: spacing.xs },
  composerInput: {
    backgroundColor: colors.chip,
    borderRadius: radius.m,
    color: colors.ink,
    flex: 1,
    maxHeight: 96,
    minHeight: 40,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    fontSize: 14,
  },
  sendButton: { backgroundColor: colors.accent, borderRadius: radius.m, paddingHorizontal: spacing.l, paddingVertical: 10 },
  smallInput: {
    backgroundColor: colors.chip,
    borderRadius: radius.s,
    color: colors.ink,
    fontSize: 13,
    minWidth: 64,
    paddingHorizontal: spacing.s,
    paddingVertical: 6,
  },
  reasonInput: { flex: 1, minWidth: 0 },
})
