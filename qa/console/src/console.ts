/**
 * Flow-recording console — a QA fixture page, NOT product UI.
 *
 * Drives the acceptance-corpus `CandidateAdapter` protocol end to end so the
 * flow-recording harness can record capture → inspect → correct → save →
 * reopen → handoff with REAL domain semantics: raw-preserving capture,
 * schema-gated extraction (failure never blocks capture), idempotent
 * captureId replay, cold-start reload equivalence, fail-closed read policy.
 *
 * The harness reads deterministic state via `window.__qa.state()`; every
 * visible panel mirrors that state so screenshots and assertions agree.
 * Synthetic family data only. No network calls beyond this static bundle.
 */
import type { CandidateAdapter, CreateEntryInput, CreateEntryResult, WireEntry } from "../../../evaluation/src/adapter.ts"
import { createAdapter } from "../../../evaluation/src/example/example-adapter.ts"

export interface QaEvent {
  readonly category: string
  readonly occurredAt: number
  readonly confidence: number
  readonly quantity: { readonly value: number; readonly unit?: string } | undefined
  readonly note: string | undefined
}

/** Shape read by qa/src/scenarios/capture-flow.ts via window.__qa.state(). */
export interface QaState {
  readonly seq: number
  readonly role: string
  readonly authorized: boolean
  readonly captureState: string
  readonly captureId: string | null
  readonly rawInputSha: string | null
  readonly rawPreserved: boolean
  readonly events: readonly QaEvent[]
  readonly eventCount: number
  readonly eventErrorsBadge: boolean
  readonly lastMessage: string | null
  readonly lastError: string | null
  readonly timelineCount: number
  readonly timelineCaptures: readonly string[]
  readonly timelineShas: Readonly<Record<string, string>>
}

type Role = "parent" | "caregiver-invited" | "unauthorized-viewer"

// --- state (mirrored to DOM by render(); read by the harness via __qa) ---
let lastEntry: WireEntry | null = null
let lastInput: CreateEntryInput | null = null
let lastInputSha: string | null = null
let lastStoredSha: string | null = null
let lastTag = "idle"
let lastMessage: string | null = null
let lastError: string | null = null
let timeline: readonly WireEntry[] = []
let timelineShas: Record<string, string> = {}
let role: Role = "parent"
let autoCaptureCounter = 0
/** Monotonic counter bumped after every async action settles — the harness
 *  waits for seq to advance so it can never read a pre-click state. */
let seq = 0

const AUTHORIZED: ReadonlySet<string> = new Set(["parent", "caregiver-invited"])

// --- adapter wrapper: fail-save injection seam for the failure/recovery step ---
const base: CandidateAdapter = createAdapter()
const adapter: CandidateAdapter = {
  name: base.name,
  async createEntry(input) {
    // Read the fail-save checkbox live at save time — no extra wiring needed.
    const box = document.getElementById("fail-save")
    if (box instanceof HTMLInputElement && box.checked) {
      box.checked = false // self-reset so the retry step succeeds
      throw new Error("Simulated backend failure — qa fail-save injection")
    }
    return base.createEntry(input)
  },
  readTimeline: () => base.readTimeline(),
  reload: () => base.reload(),
}

// --- helpers ---
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`missing #${id}`)
  return node as T
}

async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function summarize(result: CreateEntryResult): { tag: string; entry: WireEntry | null; message: string } {
  switch (result._tag) {
    case "Created":
      return { tag: "created", entry: result.entry, message: "entry persisted (capture pipeline complete)" }
    case "IdempotentReplay":
      return { tag: "idempotent-replay", entry: result.entry, message: "duplicate captureId — the ORIGINAL record wins; no second write" }
    case "Rejected":
      return { tag: "rejected", entry: null, message: `rejected: ${result.reason}` }
  }
}

function autoCaptureId(): string {
  autoCaptureCounter += 1
  return `cap-demo-${String(autoCaptureCounter).padStart(3, "0")}`
}

async function refreshTimeline(): Promise<void> {
  timeline = await adapter.readTimeline()
  const shas: Record<string, string> = {}
  for (const entry of timeline) shas[entry.captureId] = await sha256hex(entry.transcript)
  timelineShas = shas
}

// --- actions ---
async function onCapture(): Promise<void> {
  lastError = null
  const transcript = el<HTMLTextAreaElement>("transcript").value
  const input: CreateEntryInput = {
    captureId: el<HTMLInputElement>("capture-id").value.trim() || autoCaptureId(),
    transcript,
    authorId: el<HTMLInputElement>("author-id").value.trim() || "caregiver-1",
    capturedAt: Number(el<HTMLInputElement>("captured-at").value) || Date.now(),
    timezone: el<HTMLInputElement>("timezone").value.trim() || "America/New_York",
  }
  lastInput = input
  lastInputSha = await sha256hex(transcript)
  lastStoredSha = null
  lastEntry = null
  lastTag = "busy"
  lastMessage = "running capture pipeline (preserve raw → extract → validate → persist)…"
  render()
  try {
    const summary = summarize(await adapter.createEntry(input))
    lastTag = summary.tag
    lastMessage = summary.message
    lastEntry = summary.entry
    lastStoredSha = summary.entry === null ? null : await sha256hex(summary.entry.transcript)
  } catch (err) {
    lastTag = "error"
    lastMessage = "save failed — nothing persisted"
    lastError = err instanceof Error ? err.message : String(err)
  }
  await refreshTimeline()
  seq += 1
  render()
}

async function onReload(): Promise<void> {
  lastError = null
  lastTag = "busy"
  lastMessage = "simulating cold start…"
  render()
  await adapter.reload()
  await refreshTimeline()
  lastTag = "reloaded"
  lastMessage = `cold start simulated — timeline re-read from durable state (${timeline.length} entries)`
  seq += 1
  render()
}

function onRoleChange(): void {
  role = el<HTMLSelectElement>("role-select").value as Role
  render()
}

// --- render (DOM mirrors __qa state exactly) ---
function render(): void {
  const stateEl = el<HTMLElement>("capture-state")
  stateEl.textContent = lastTag
  stateEl.className = `state state-${lastTag === "idempotent-replay" ? "replay" : lastTag}`
  el<HTMLElement>("capture-id-echo").textContent = lastInput === null ? "" : `captureId ${lastInput.captureId}`
  el<HTMLElement>("result-message").textContent = lastMessage ?? ""

  el<HTMLElement>("event-errors-badge").hidden = !(lastTag === "created" && lastEntry !== null && lastEntry.events.length === 0)

  const eventsEl = el<HTMLElement>("events")
  eventsEl.textContent = ""
  if (lastEntry !== null && lastTag !== "error") {
    for (const ev of lastEntry.events) {
      const chip = document.createElement("span")
      chip.className = "chip"
      const qty = ev.quantity === undefined ? "" : ` · ${ev.quantity.value}${ev.quantity.unit === undefined ? "" : ` ${ev.quantity.unit}`}`
      chip.textContent = `${ev.category}${qty} · conf ${ev.confidence.toFixed(2)} · ${new Date(ev.occurredAt).toISOString()}`
      eventsEl.appendChild(chip)
    }
  }

  el<HTMLElement>("raw-echo").textContent = lastInput === null ? "—" : JSON.stringify(lastInput.transcript)
  el<HTMLElement>("raw-sha").textContent =
    lastInput === null || lastInputSha === null
      ? "—"
      : `input  sha256 ${lastInputSha.slice(0, 16)}…   stored sha256 ${lastStoredSha === null ? "—" : `${lastStoredSha.slice(0, 16)}…`}   ${
          lastStoredSha === null ? "" : lastInputSha === lastStoredSha ? "✓ byte-for-byte preserved" : "✗ MISMATCH"
        }`

  const errEl = el<HTMLElement>("error-message")
  errEl.hidden = lastError === null
  errEl.textContent = lastError ?? ""

  const authorized = AUTHORIZED.has(role)
  el<HTMLElement>("timeline-denied").hidden = authorized
  const list = el<HTMLElement>("timeline")
  list.textContent = ""
  if (authorized) {
    for (const e of timeline) {
      const li = document.createElement("li")
      const head = document.createElement("div")
      head.textContent = `${e.captureId} · ${e.status} · by ${e.authorId} · ${e.events.length} event(s) · ${new Date(e.createdAt).toISOString()}`
      const raw = document.createElement("div")
      raw.className = "muted"
      raw.textContent = JSON.stringify(e.transcript)
      li.appendChild(head)
      li.appendChild(raw)
      list.appendChild(li)
    }
  }
  el<HTMLElement>("role-banner").textContent = authorized
    ? `Authorized viewer (${role}): timeline visible — ${timeline.length} entries.`
    : `Unauthorized viewer (${role}): read denied, nothing rendered (fail-closed).`
}

// --- qa hook ---
function qaState(): QaState {
  const authorized = AUTHORIZED.has(role)
  return {
    seq,
    role,
    authorized,
    captureState: lastTag,
    captureId: lastInput?.captureId ?? null,
    rawInputSha: lastInputSha,
    rawPreserved: lastInputSha !== null && lastInputSha === lastStoredSha,
    events: (lastEntry?.events ?? []).map((ev) => ({
      category: ev.category,
      occurredAt: ev.occurredAt,
      confidence: ev.confidence,
      quantity: ev.quantity,
      note: ev.note,
    })),
    eventCount: lastEntry?.events.length ?? 0,
    eventErrorsBadge: lastTag === "created" && lastEntry !== null && lastEntry.events.length === 0,
    lastMessage,
    lastError,
    timelineCount: authorized ? timeline.length : 0,
    timelineCaptures: authorized ? timeline.map((e) => e.captureId) : [],
    timelineShas: authorized ? timelineShas : {},
  }
}

function boot(): void {
  ;(window as unknown as { __qa: { state(): QaState } }).__qa = { state: qaState }
  el<HTMLTextAreaElement>("transcript").value =
    "Ava had 8 ounces of milk with breakfast at 8:00 AM. Then she went poop on the potty at 9:30 AM. Before lunch she was really happy and giggly at 12:45 PM."
  el<HTMLButtonElement>("capture-btn").addEventListener("click", () => void onCapture())
  el<HTMLButtonElement>("reload-btn").addEventListener("click", () => void onReload())
  el<HTMLSelectElement>("role-select").addEventListener("change", onRoleChange)
  render()
}

boot()
