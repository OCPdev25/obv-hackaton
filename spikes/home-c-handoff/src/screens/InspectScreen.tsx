import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { confidenceLabel, etTime, eventById } from "../data"
import { Btn, C, Caption, Card, Chip, Screen } from "../ui"

/**
 * S1-B / S1-C — inspect and correct. Three bundled actions, each with a
 * preview before confirm (D2: change previewed, source excerpt visible while
 * correcting, append-only lineage — the original is never erased).
 */
type Tab = "sleep" | "audience" | "photo"

export const InspectScreen = ({ eventId, onDone }: { eventId: string; onDone: () => void }) => {
  const [tab, setTab] = useState<Tab>("sleep")
  const [step, setStep] = useState(0)
  const misread = eventById("ev-sleep-1")
  const corrected = eventById("ev-sleep-2")
  const school = eventById("ev-school-1")
  const meal = eventById("ev-meal-1")
  const opened = eventById(eventId)

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <Text style={local.title}>Inspect event</Text>
        {opened !== undefined && (
          <Card title="Opened from a source link (S1-C)">
            <Text style={local.body}>“{opened.wire.note}”</Text>
            <Caption>
              {etTime(opened.wire.occurredAt)} · {confidenceLabel(opened.wire)} · transcript excerpt is
              one tap away — every fact links back to the raw capture.
            </Caption>
          </Card>
        )}

        <View style={local.tabs}>
          <Chip label="1 · Correct the misread" tone={tab === "sleep" ? "accent" : "default"} onPress={() => { setTab("sleep"); setStep(0) }} />
          <Chip label="2 · Audience (parents only)" tone={tab === "audience" ? "accent" : "default"} onPress={() => { setTab("audience"); setStep(0) }} />
          <Chip label="3 · Attach photo" tone={tab === "photo" ? "accent" : "default"} onPress={() => { setTab("photo"); setStep(0) }} />
        </View>

        {tab === "sleep" && misread !== undefined && corrected !== undefined && (
          <>
            <Card title={`Current: ${misread.wire.note}`}>
              <Caption>
                {etTime(misread.wire.occurredAt)} · {confidenceLabel(misread.wire)} — low confidence is
                the tell. Elena corrects it at 07:44 (S1-B).
              </Caption>
              {step === 0 && <Btn label="Correct this event" primary onPress={() => setStep(1)} />}
            </Card>
            {step >= 1 && (
              <Card title="Correction (previewed before confirm)">
                <Text style={local.body}>Night waking · 23:00 → 00:30 (90 min)</Text>
                {step === 1 && <Btn label="Preview change" primary onPress={() => setStep(2)} />}
              </Card>
            )}
            {step >= 2 && (
              <Card title="Preview — nothing applied yet">
                <Text style={local.diffOld}>— {misread.wire.note} ({etTime(misread.wire.occurredAt)}, confidence 0.61)</Text>
                <Text style={local.diffNew}>+ {corrected.wire.note} (23:00–00:30, caregiver-confirmed 1.0)</Text>
                <Caption>
                  Source excerpt stays visible while correcting: “She woke at eleven last night and
                  was up until twelve thirty.”
                </Caption>
                {step === 2 && <Btn label="Confirm correction" primary tone="ok" onPress={() => setStep(3)} />}
              </Card>
            )}
            {step >= 3 && (
              <Card title="Applied — append-only lineage" tone="ok">
                <Caption>
                  ev-sleep-2 supersedes ev-sleep-1; the original stays inspectable. Confidence 1.0
                  pins it: a rerun never downgrades a caregiver-confirmed event — this is what makes
                  the correction survive attempt 1 at 07:53.
                </Caption>
              </Card>
            )}
          </>
        )}

        {tab === "audience" && school !== undefined && (
          <Card title="Drop-off meltdown — audience restriction">
            <Text style={local.body}>“{school.wire.note}”</Text>
            <View style={local.tabs}>
              <Chip label="Household" tone={false ? "accent" : "default"} />
              <Chip label="🔒 Parents only" tone="accent" />
            </View>
            <Caption>
              Restricted at 07:45, per the grants model. Audience is a separate dimension from
              publication state (contract v0.2 decision 1); per-event restriction is a PROPOSED
              extension in this prototype's data layer — flagged in the evidence document.
            </Caption>
          </Card>
        )}

        {tab === "photo" && meal !== undefined && (
          <Card title="Breakfast — attach the photo">
            <Text style={local.body}>“{meal.wire.note}”</Text>
            <Chip label="📷 breakfast-photo.png attached (S1-B)" tone="ok" />
            <Caption>
              Photo rides the entry (photoId, contract v0.2 Entry.photoId); the source link from the
              meal event opens transcript excerpt + photo together (S1-C).
            </Caption>
          </Card>
        )}

        <View style={local.navRow}>
          <Btn label="‹ Back to home" onPress={onDone} />
        </View>
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32, gap: 4 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 },
  body: { color: C.text, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  diffOld: { color: C.dim, fontSize: 13.5, lineHeight: 19, textDecorationLine: "line-through" },
  diffNew: { color: C.ok, fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
  navRow: { marginTop: 8 },
})
