/**
 * Integrated-arena adapter wrapper — the harness entry point for the
 * integrated capture pipeline living in packages/capture.
 *
 * Thin on purpose: it exists only to type-check the integrated adapter
 * against the corpus CandidateAdapter interface (packages/capture stays
 * corpus-agnostic and imports nothing from evaluation/).
 */
import type { CandidateAdapter } from './adapter.ts'

// Plain relative import (bun resolves it; evaluation/ is not a pnpm
// workspace member, so no package boundary is crossed). The capture package
// itself stays corpus-agnostic — it imports nothing from evaluation/.
import { createIntegratedAdapter } from '../../packages/capture/src/evaluation-adapter.ts'

export const createAdapter = (): CandidateAdapter => createIntegratedAdapter()
