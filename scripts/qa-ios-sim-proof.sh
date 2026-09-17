#!/usr/bin/env bash
#
# qa-ios-sim-proof.sh — repeatable macOS runbook for the PR #8 device-proof
# checklist (spikes/voice-photo README), executed on an Apple/MacOS machine.
#
# Provisions nothing: it verifies the toolchain, builds the custom dev client,
# boots an iOS simulator, installs/launches the QA proof surface, and captures
# evidence (screenshots + screen recording). Re-runnable; use --fresh to reset
# app permissions so the permission prompts (checklist items 3-5) replay.
#
# Requirements (verified in step 0, all fail loudly if missing):
#   - macOS with Xcode 26 (iOS 26 SDK) — SpeechAnalyzer APIs are iOS 26
#   - CocoaPods (`pod` on PATH) — brew install cocoapods
#   - Node >= 20 + corepack (pnpm 10)
#
# Usage:
#   ./scripts/qa-ios-sim-proof.sh              # build, boot, install, launch, record
#   ./scripts/qa-ios-sim-proof.sh --fresh      # additionally reset app permissions first
#
# Environment overrides: SIM_NAME, SIM_RUNTIME, EVIDENCE_DIR
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/mobile"
EVIDENCE_DIR="${EVIDENCE_DIR:-${REPO_ROOT}/spikes/voice-photo/qa-evidence/$(date -u +%Y%m%dT%H%M%SZ)}"
SIM_NAME="${SIM_NAME:-iPhone 17 Pro}"
BUNDLE_ID="com.obvhackaton.sharedchildjournal"
SCHEME="SharedChildJournal"
FRESH_PERMISSIONS=false
[[ "${1:-}" == "--fresh" ]] && FRESH_PERMISSIONS=true

mkdir -p "${EVIDENCE_DIR}"

section() { printf '\n===== %s =====\n' "$1"; }

section "0. Toolchain + environment versions (goes into the evidence record)"
sw_vers
xcodebuild -version
xcrun simctl list runtimes | grep -i ios || true
xcrun simctl list devices available | grep -A2 "iOS" || true
node --version
corepack --version 2>/dev/null || true
pod --version

section "1. Install workspace (frozen lockfile — CI parity)"
cd "${REPO_ROOT}"
corepack enable
pnpm install --frozen-lockfile

section "2. Convex backend for the photo flow (item 9)"
# Local-real Convex backend in a tmux session; the app/driver point at it.
if ! tmux has-session -t qa-convex 2>/dev/null; then
  tmux new-session -d -s qa-convex "cd '${REPO_ROOT}' && npx convex dev --dir='${REPO_ROOT}/spikes/voice-photo/qa-convex' 2>&1 | tee '${EVIDENCE_DIR}/convex-dev.log'"
  sleep 20
fi
CONVEX_URL="$(grep -rhoE 'https?://127\.0\.0\.1:[0-9]+' "${REPO_ROOT}/.env.local" "${REPO_ROOT}/spikes/voice-photo/qa-convex/.env.local" 2>/dev/null | head -1 || true)"
if [[ -z "${CONVEX_URL}" ]]; then
  echo "WARNING: could not auto-detect local Convex URL — read it from the tmux session (tmux attach -t qa-convex) and export CONVEX_URL."
fi
printf 'EXPO_PUBLIC_CONVEX_URL=%s\nEXPO_PUBLIC_QA_PROOF=1\n' "${CONVEX_URL}" > "${APP_DIR}/.env"
echo "apps/mobile/.env -> ${CONVEX_URL}"

section "3. Real-backend flow evidence from the CLI (item 9, driver)"
if [[ -n "${CONVEX_URL}" ]]; then
  bun spikes/voice-photo/qa/evidence-3request-flow.ts "${CONVEX_URL}" | tee "${EVIDENCE_DIR}/flow-driver.log"
else
  echo "SKIPPED: no CONVEX_URL"
fi

section "4. Native project generation + pod install (dev-client build, item 2)"
cd "${APP_DIR}"
npx expo prebuild --platform ios --no-install 2>&1 | tee "${EVIDENCE_DIR}/prebuild.log"
cd ios
pod install 2>&1 | tee "${EVIDENCE_DIR}/pod-install.log"

section "5. Boot simulator + build + install dev client"
xcrun simctl boot "${SIM_NAME}" 2>/dev/null || true
open -a Simulator
xcodebuild -workspace "${APP_DIR}/ios/${SCHEME}.xcworkspace" \
  -scheme "${SCHEME}" -configuration Debug \
  -destination "platform=iOS Simulator,name=${SIM_NAME}" \
  -derivedDataPath "${APP_DIR}/.qa-build/DerivedData" \
  build 2>&1 | tee "${EVIDENCE_DIR}/xcodebuild.log" | tail -20
APP_PATH="${APP_DIR}/.qa-build/DerivedData/Build/Products/Debug-iphonesimulator/${SCHEME}.app"
xcrun simctl install booted "${APP_PATH}"

if ${FRESH_PERMISSIONS}; then
  section "5b. Reset permissions so prompts replay (items 3-5)"
  xcrun simctl privacy booted reset all "${BUNDLE_ID}"
fi

section "6. Launch + record evidence"
xcrun simctl io booted recordVideo --codec h264 --force "${EVIDENCE_DIR}/sim-run.mp4" &
RECORD_PID=$!
sleep 2
xcrun simctl launch booted "${BUNDLE_ID}" | tee "${EVIDENCE_DIR}/launch.txt"
sleep 5
xcrun simctl io booted screenshot "${EVIDENCE_DIR}/01-launch-proof-screen.png"
echo "NOW DRIVE THE PROOF SCREEN: tap each button; between taps the log fills."
echo "  [2]+[7]: Probe module + locales   [6]: Prepare en-US"
echo "  [3]+[8]+[1]: Record 4s + transcribe (grant the mic prompt)"
echo "  [4]+[9]: Pick photo -> Convex (grant the photo prompt)"
sleep 10
xcrun simctl io booted screenshot "${EVIDENCE_DIR}/02-after-probes.png"
kill -INT "${RECORD_PID}" 2>/dev/null || true
sleep 1

section "7. Evidence inventory"
ls -la "${EVIDENCE_DIR}"
echo
echo "Fill spikes/voice-photo/QA-DEVICE-PROOF.md with the observed results and"
echo "the exact versions printed in step 0. Label every artifact SIMULATOR"
echo "evidence; hardware-only items stay hardware-only."
