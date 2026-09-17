/**
 * Month-history prototype screen (RN).
 *
 * Deterministic prototype over the synthetic family fixture: it renders the
 * SAME authorized view the executable journeys assert against, via
 * buildAuthorizedView. Data discipline is one-to-one with the view contract:
 * raw transcripts verbatim, capture attribution always visible, gaps honest,
 * corrections disclosed with lineage, failed extraction never blocked, and
 * every day cell screen-reader reachable (role/hint/label from the package).
 *
 * Wire-up to the Convex timeline (replacing the fixture input) is a follow-up;
 * the view-input adapters in the package are the seam for that swap.
 */
import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import {
  FONT_SCALING,
  GAP_DISCLAIMER,
  HOUSEHOLD_ID,
  HOUSEHOLD_ZONE,
  MOM,
  buildAuthorizedView,
  type EntryCardView,
  type EventCardView,
} from "@journal/month-history"
import { Text } from "@journal/ui"

const PROTOTYPE_MONTH = "2026-09"

export function MonthHistoryScreen() {
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>("2026-09-12")

  const { access, view } = useMemo(
    () =>
      buildAuthorizedView(
        { kind: "caregiver", caregiverId: MOM, householdIds: [HOUSEHOLD_ID] },
        PROTOTYPE_MONTH,
        HOUSEHOLD_ZONE,
      ),
    [],
  )

  if (access.outcome !== "allowed") {
    return (
      <View style={styles.container}>
        <Text allowFontScaling maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}>
          You do not have access to this timeline.
        </Text>
      </View>
    )
  }

  const selectedDay = view.days.find((day) => day.dateKey === selectedDayKey)

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.chrome.maxFontSizeMultiplier}
        accessibilityRole="header"
        accessibilityLabel={view.headerA11yLabel}
        style={styles.header}
      >
        {view.monthLabel}
      </Text>

      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
        style={styles.gapStatement}
      >
        {view.gap.message} {GAP_DISCLAIMER}
      </Text>

      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.chrome.maxFontSizeMultiplier}
        style={styles.totals}
      >
        {view.totalEntries} entries · {view.totalEvents} care events
      </Text>

      <View style={styles.grid}>
        {view.days.map((day) => (
          <DayCell
            key={day.dateKey}
            dateKey={day.dateKey}
            dayLabel={day.dayLabel}
            entryCount={day.entryCount}
            a11yRole={day.a11yRole}
            a11yHint={day.a11yHint}
            a11yLabel={day.a11yLabel}
            selected={day.dateKey === selectedDayKey}
            onPress={() => setSelectedDayKey(day.dateKey)}
          />
        ))}
      </View>

      {selectedDay ? (
        <View style={styles.dayPanel}>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={FONT_SCALING.chrome.maxFontSizeMultiplier}
            accessibilityRole="header"
            style={styles.dayPanelHeader}
          >
            {selectedDay.dayLabel}
          </Text>
          {selectedDay.entries.map((entry) => (
            <EntryCard key={entry.entryId} entry={entry} />
          ))}
          {selectedDay.entries.length === 0 ? (
            <Text
              allowFontScaling
              maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
              style={styles.noEntries}
            >
              No entries recorded
            </Text>
          ) : null}
          {selectedDay.events.map((event) => (
            <EventLine key={event.eventId} event={event} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

interface DayCellProps {
  readonly dateKey: string
  readonly dayLabel: string
  readonly entryCount: number
  readonly a11yRole: "button"
  readonly a11yHint: string
  readonly a11yLabel: string
  readonly selected: boolean
  readonly onPress: () => void
}

function DayCell(props: DayCellProps) {
  const dayOfMonth = Number(props.dateKey.slice(8, 10))
  return (
    <Pressable
      accessibilityRole={props.a11yRole}
      accessibilityHint={props.a11yHint}
      accessibilityLabel={props.a11yLabel}
      onPress={props.onPress}
      style={[styles.cell, props.selected ? styles.cellSelected : null]}
    >
      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.chrome.maxFontSizeMultiplier}
        style={styles.cellDay}
      >
        {dayOfMonth}
      </Text>
      {props.entryCount > 0 ? <View style={styles.cellDot} /> : null}
    </Pressable>
  )
}

function EntryCard({ entry }: { entry: EntryCardView }) {
  return (
    <View style={styles.entryCard}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
        style={styles.entryTranscript}
      >
        {entry.transcript}
      </Text>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.chrome.maxFontSizeMultiplier}
        style={styles.entryMeta}
      >
        {entry.authorName} · {entry.captureLabel}
      </Text>
      {entry.extractionStatusLabel ? (
        <Text
          allowFontScaling
          maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
          style={styles.entryFailed}
        >
          {entry.extractionStatusLabel}
        </Text>
      ) : null}
      {entry.correctionLineage ? (
        <View style={styles.lineage}>
          {entry.correctionLineage.steps.map((step) => (
            <Text
              key={step.correctionId}
              allowFontScaling
              maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
              style={styles.lineageStep}
            >
              Corrected by {step.byName} — {step.createdAtLabel}
              {step.reason ? ` · ${step.reason}` : ""}
            </Text>
          ))}
          <Text
            allowFontScaling
            maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
            style={styles.lineagePreserved}
          >
            {entry.correctionLineage.originalPreservedLabel}
          </Text>
        </View>
      ) : null}
      <Text style={styles.srOnly} aria-hidden>
        {entry.a11yLabel}
      </Text>
    </View>
  )
}

function EventLine({ event }: { event: EventCardView }) {
  return (
    <View style={styles.eventLine}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={FONT_SCALING.body.maxFontSizeMultiplier}
        style={styles.eventText}
      >
        {event.category} — {event.localTimeLabel}
        {event.isLate && event.lateLabel ? ` · ${event.lateLabel}` : ""}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  header: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
  gapStatement: { marginBottom: 4 },
  totals: { fontSize: 13, opacity: 0.7, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cell: {
    alignItems: "center",
    borderRadius: 8,
    flexGrow: 1,
    flexBasis: "12%",
    padding: 8,
    minHeight: 40,
    justifyContent: "center",
  },
  cellSelected: { backgroundColor: "#dce9ff" },
  cellDay: { fontSize: 14 },
  cellDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#2f6fed", marginTop: 3 },
  dayPanel: { marginTop: 16, gap: 8 },
  dayPanelHeader: { fontSize: 17, fontWeight: "600" },
  entryCard: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 6 },
  entryTranscript: {},
  entryMeta: { fontSize: 12, opacity: 0.7 },
  entryFailed: { color: "#8a5a00" },
  lineage: { gap: 2 },
  lineageStep: { fontSize: 13 },
  lineagePreserved: { fontSize: 12, opacity: 0.7 },
  noEntries: { opacity: 0.7 },
  eventLine: { paddingLeft: 4 },
  eventText: {},
  srOnly: { height: 0, opacity: 0 },
})
