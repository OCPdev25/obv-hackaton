/**
 * PROTOTYPE — typecheck-verified only, NOT device-verified.
 *
 * Since-last-seen catch-up view (contract delta v0.1, art_6qhBut41).
 * Presentational: renders a validated domain `CatchUpReport`. The caller owns
 * fetching (`getCatchUp`) and watermark advance (`advanceReadState`); this
 * component holds no data access, no navigation, no provider wiring, and no
 * new dependencies. Disclosure discipline mirrors the domain contract: gaps
 * are phrased only as missing recordings — never as "nothing happened" — the
 * transcript is shown verbatim (excerpted, never paraphrased), and events
 * with confidence below 1 are always marked inferred.
 */
import { ScrollView, StyleSheet, View } from "react-native"

import { gapDisclosure, type CatchUpItem, type CatchUpReport } from "@journal/domain"
import { Text } from "@journal/ui"

const TRANSCRIPT_EXCERPT_MAX = 140

const isoDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10)

const excerptOf = (transcript: string): string =>
  transcript.length <= TRANSCRIPT_EXCERPT_MAX
    ? transcript
    : `${transcript.slice(0, TRANSCRIPT_EXCERPT_MAX)}…`

/** Kind badge; late items name both ends of the delay (happened vs recorded). */
const kindBadgeText = (item: CatchUpItem): string => {
  if (item.kind === "late" && item.daysLate !== undefined) {
    return `late: happened ${isoDay(item.occurredAt ?? item.entryCreatedAt)}, recorded ${isoDay(item.entryCreatedAt)}`
  }
  return item.kind
}

/** One canonical event line; confidence below 1 is always disclosed. */
const eventLine = (category: string, payload: Record<string, number> | undefined, confidence: number): string => {
  const values =
    payload === undefined
      ? ""
      : Object.entries(payload)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")
  const summary = values.length > 0 ? `${category} (${values})` : category
  return confidence < 1 ? `${summary} — inferred` : summary
}

/** Typecheck-only usage example: proves the props contract, routes nothing. */
export function CatchUpViewUsageExample({ report }: { report: CatchUpReport }) {
  return <CatchUpView report={report} />
}

export function CatchUpView({ report }: { report: CatchUpReport }) {
  const disclosure = gapDisclosure(report.coverageDays)
  const confirmed = report.confirmation.confirmedEvents
  const total = confirmed + report.confirmation.inferredEvents
  const newItems = report.items.filter((item) => item.kind !== "corrected")
  const correctedItems = report.items.filter((item) => item.kind === "corrected")

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text>
          Catch-up {isoDay(report.windowStart)} – {isoDay(report.windowEnd)}
        </Text>
        <Text>
          {report.allCaughtUp ? "You're all caught up." : "Here's what was recorded while you were away."}
        </Text>
      </View>

      {newItems.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>New while you were away</Text>
          {newItems.map((item) => (
            <View key={item.entryId} style={styles.card}>
              <Text style={styles.badge}>{kindBadgeText(item)}</Text>
              <Text>Recorded by {item.source.authorId}</Text>
              <Text>"{excerptOf(item.source.rawTranscript)}"</Text>
              {item.events.map((event, index) => (
                <Text
                  key={`${item.entryId}-event-${index}`}
                >{`${eventLine(event.category, event.payload, event.confidence)} · ${isoDay(event.timestamp)}`}</Text>
              ))}
            </View>
          ))}
        </View>
      )}

      {correctedItems.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Corrected</Text>
          {correctedItems.map((item) => (
            <View key={item.entryId} style={styles.card}>
              {/* The report carries the revised (canonical) value and the
                  original's citation — never an invented original value. */}
              {item.events.map((event, index) => (
                <Text
                  key={`${item.entryId}-revised-${index}`}
                >{`Corrected: ${eventLine(event.category, event.payload, event.confidence)} · ${isoDay(event.timestamp)}`}</Text>
              ))}
              <Text>
                {`Revised by ${item.correctedBy ?? "unknown"} · original event ${item.originalEventId ?? "unknown"}${item.revisionIds.length > 0 ? ` · ${item.revisionIds.length} revision(s)` : ""}`}
              </Text>
              <Text>"{excerptOf(item.source.rawTranscript)}"</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        {disclosure.length > 0 && <Text>{disclosure}</Text>}
        <Text>{`${confirmed} of ${total} events caregiver-confirmed`}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, gap: 4 },
  section: { padding: 16, paddingTop: 0, gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "600" },
  card: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, gap: 4 },
  badge: { fontWeight: "600" },
  footer: { padding: 16, gap: 4 },
})
