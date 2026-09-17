/**
 * Prototype screen for the caregiver-questions contract (Journal & Caregiver
 * Coordination lane). In-memory seed mirroring
 * evaluation/fixtures/agent-experience/caregiver-questions/household-a.json —
 * activities are appended locally and nothing is written to Convex yet.
 *
 * What this demonstrates beyond transcription:
 * - one question card per open thread, with lifecycle status and reopen count
 * - fail-closed visibility per viewer (switch viewers to see the list change)
 * - the asker of a DIRECTED question resolves instead of answering
 * - a handoff digest card that renders "no questions asked" as its own fact
 */
import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native"

import { deriveQuestionState } from "@journal/domain"
import type { CareQuestionActivityDocument, CareQuestionDocument, QuestionTargetFacts } from "@journal/domain"

import { Text } from "@journal/ui"

import { digestFor, formatEpochTime, handoffSummary, statusLabel, viewerCanAnswer, viewerCanReopen, viewerCanResolve, visibleSeeds, type QuestionSeed } from "./logic"

const HOUSEHOLD_A = "household_a"
const CHILD = "child_a"

interface Viewer {
  readonly id: string
  readonly label: string
  readonly householdIds: readonly string[]
}

const VIEWERS: readonly Viewer[] = [
  { id: "caregiver-mom", label: "Mom", householdIds: [HOUSEHOLD_A] },
  { id: "caregiver-dad", label: "Dad", householdIds: [HOUSEHOLD_A] },
  { id: "caregiver-grandma", label: "Grandma", householdIds: [HOUSEHOLD_A] },
  { id: "caregiver-nanny", label: "Nanny", householdIds: [HOUSEHOLD_A, "household_b"] },
]

interface EntrySeed {
  readonly id: string
  readonly label: string
  readonly authorId: string
  readonly visibility: "draft" | "published"
}

const ENTRIES: readonly EntrySeed[] = [
  { id: "entry_meal", label: "Lunch entry", authorId: "caregiver-dad", visibility: "published" },
  { id: "entry_sleep", label: "Nap entry", authorId: "caregiver-dad", visibility: "published" },
  { id: "entry_outdoor", label: "Outdoor play (Nanny's draft)", authorId: "caregiver-nanny", visibility: "draft" },
]

const targetOf = (entryId: string): QuestionTargetFacts => {
  const entry = ENTRIES.find((e) => e.id === entryId)
  if (!entry) throw new Error(`unknown entry ${entryId}`)
  return {
    householdId: HOUSEHOLD_A,
    childId: CHILD,
    authorId: entry.authorId,
    visibility: entry.visibility,
  }
}

const baseQuestion = (overrides: Partial<CareQuestionDocument>): CareQuestionDocument => ({
  _id: "q_seed",
  _creationTime: 1789651800000,
  householdId: HOUSEHOLD_A,
  childId: CHILD,
  entryId: "entry_meal",
  targetKind: "entry",
  askedById: "caregiver-mom",
  audienceKind: "household",
  addresseeIds: [],
  handoffIncluded: true,
  question: "Did she drink water with lunch?",
  createdAt: 1789651800000,
  ...overrides,
})

const SEED_ACTIVITIES: readonly CareQuestionActivityDocument[] = [
  {
    _id: "act_nap_answer",
    _creationTime: 1789655400000,
    householdId: HOUSEHOLD_A,
    childId: CHILD,
    questionId: "q_nap",
    kind: "answered",
    at: 1789655400000,
    answerText: "Two naps, about 45 minutes each.",
    actorId: "caregiver-dad",
  },
  {
    _id: "act_potty_answer",
    _creationTime: 1789659000000,
    householdId: HOUSEHOLD_A,
    childId: CHILD,
    questionId: "q_potty",
    kind: "answered",
    at: 1789659000000,
    answerText: "None today.",
    actorId: "caregiver-dad",
  },
  {
    _id: "act_potty_resolve",
    _creationTime: 1789662600000,
    householdId: HOUSEHOLD_A,
    childId: CHILD,
    questionId: "q_potty",
    kind: "resolved",
    at: 1789662600000,
    actorId: "caregiver-mom",
  },
]

const initialSeeds = (): QuestionSeed[] => [
  {
    question: baseQuestion({ _id: "q_water", question: "Did she drink water with lunch?" }),
    activities: [],
    target: targetOf("entry_meal"),
  },
  {
    question: baseQuestion({
      _id: "q_nap",
      entryId: "entry_sleep",
      question: "How long were her naps today?",
      createdAt: 1789651800000 + 1,
      audienceKind: "directed",
      addresseeIds: ["caregiver-dad"],
    }),
    activities: SEED_ACTIVITIES.filter((a) => a.questionId === "q_nap"),
    target: targetOf("entry_sleep"),
  },
  {
    question: baseQuestion({ _id: "q_potty", question: "Any potty accidents after lunch?", createdAt: 1789651800000 + 2 }),
    activities: SEED_ACTIVITIES.filter((a) => a.questionId === "q_potty"),
    target: targetOf("entry_meal"),
  },
  {
    question: baseQuestion({
      _id: "q_outdoor",
      entryId: "entry_outdoor",
      askedById: "caregiver-nanny",
      question: "Is outdoor play okay before pickup?",
      createdAt: 1789651800000 + 3,
      audienceKind: "directed",
      addresseeIds: ["caregiver-dad"],
    }),
    activities: [],
    target: targetOf("entry_outdoor"),
  },
]

export const CareQuestionsDemo = () => {
  const [seeds, setSeeds] = useState<QuestionSeed[]>(initialSeeds)
  const [viewerId, setViewerId] = useState<string>("caregiver-mom")
  const [draft, setDraft] = useState<string>("")

  const viewer = useMemo(() => VIEWERS.find((v) => v.id === viewerId) ?? VIEWERS[0], [viewerId])
  if (!viewer) return null

  const principal = { kind: "caregiver", caregiverId: viewer.id, householdIds: viewer.householdIds } as const
  const visible = visibleSeeds(seeds, principal)
  const digest = digestFor(seeds, { windowStart: 1789617600000 })

  const appendActivity = (questionId: string, activity: CareQuestionActivityDocument) => {
    setSeeds((prev) =>
      prev.map((seed) => (seed.question._id === questionId ? { ...seed, activities: [...seed.activities, activity] } : seed)),
    )
    setDraft("")
  }

  const answer = (questionId: string) => {
    const text = draft.trim()
    if (text.length === 0) return
    appendActivity(questionId, {
      _id: `local-${questionId}-${Date.now()}`,
      _creationTime: Date.now(),
      householdId: HOUSEHOLD_A,
      childId: CHILD,
      questionId,
      kind: "answered",
      at: Date.now(),
      answerText: text,
      actorId: viewer.id,
    })
  }

  const resolve = (questionId: string) => {
    appendActivity(questionId, {
      _id: `local-${questionId}-${Date.now()}`,
      _creationTime: Date.now(),
      householdId: HOUSEHOLD_A,
      childId: CHILD,
      questionId,
      kind: "resolved",
      at: Date.now(),
      actorId: viewer.id,
    })
  }

  const reopen = (questionId: string) => {
    appendActivity(questionId, {
      _id: `local-${questionId}-${Date.now()}`,
      _creationTime: Date.now(),
      householdId: HOUSEHOLD_A,
      childId: CHILD,
      questionId,
      kind: "reopened",
      at: Date.now(),
      reason: "Follow-up needed",
      actorId: viewer.id,
    })
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.heading}>Caregiver questions</Text>
      <Text style={styles.hint}>
        Prototype: authorization runs through the domain policy; activities stay on-device.
      </Text>

      <View style={styles.viewerRow}>
        {VIEWERS.map((v) => (
          <Pressable
            key={v.id}
            style={[styles.chip, v.id === viewer.id && styles.chipActive]}
            onPress={() => setViewerId(v.id)}
          >
            <Text style={v.id === viewer.id ? styles.chipTextActive : styles.chipText}>{v.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.digestCard}>
        <Text style={styles.digestTitle}>Handoff digest</Text>
        <Text>{handoffSummary(digest)}</Text>
      </View>

      {visible.length === 0 ? (
        <Text style={styles.empty}>No questions are visible for this viewer.</Text>
      ) : (
        visible.map((seed) => {
          const derived = statusLabel(deriveQuestionState(seed.question, seed.activities))
          const canAnswer = viewerCanAnswer(seed, principal, viewer.id)
          const canResolve = viewerCanResolve(seed, principal, viewer.id)
          const canReopen = viewerCanReopen(seed, principal, viewer.id)
          return (
            <View key={seed.question._id} style={styles.card}>
              <Text style={styles.status}>{derived}</Text>
              <Text style={styles.question}>{seed.question.question}</Text>
              <Text style={styles.meta}>
                {seed.question.audienceKind === "directed"
                  ? `Directed at ${seed.question.addresseeIds.join(", ")}`
                  : "Household audience"}
                {" · "}
                {seed.question.targetKind === "event" ? "event" : "entry"} · {formatEpochTime(seed.question.createdAt)}
              </Text>
              {seed.activities
                .filter((a) => a.kind === "answered")
                .map((a) => (
                  <Text key={a._id} style={styles.answer}>
                    {a.actorId}: {a.answerText ?? ""}
                  </Text>
                ))}
              {canAnswer ? <TextInput style={styles.input} placeholder="Answer…" value={draft} onChangeText={setDraft} /> : null}
              <View style={styles.actionRow}>
                {canAnswer ? (
                  <Pressable style={styles.action} onPress={() => answer(seed.question._id)}>
                    <Text style={styles.actionText}>Answer</Text>
                  </Pressable>
                ) : null}
                {canResolve ? (
                  <Pressable style={styles.action} onPress={() => resolve(seed.question._id)}>
                    <Text style={styles.actionText}>Confirm &amp; resolve</Text>
                  </Pressable>
                ) : null}
                {canReopen ? (
                  <Pressable style={styles.action} onPress={() => reopen(seed.question._id)}>
                    <Text style={styles.actionText}>Reopen</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )
        })
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "700" },
  hint: { fontSize: 12, opacity: 0.7 },
  viewerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#bbb", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 },
  chipActive: { backgroundColor: "#333", borderColor: "#333" },
  chipText: { color: "#333" },
  chipTextActive: { color: "#fff" },
  digestCard: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, gap: 4 },
  digestTitle: { fontWeight: "700" },
  empty: { opacity: 0.7, fontStyle: "italic" },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, gap: 6 },
  status: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", opacity: 0.6 },
  question: { fontSize: 16 },
  meta: { fontSize: 12, opacity: 0.6 },
  answer: { fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#bbb", borderRadius: 8, padding: 8 },
  actionRow: { flexDirection: "row", gap: 8 },
  action: { backgroundColor: "#eee", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 13 },
})
