# NOTICE

This repository vendors third-party agent skills as verbatim copies for local,
editable use. Each vendored source is recorded below with its upstream commit,
license, and what was included or excluded.

## Vendored sources

### 1. mattpocock/skills — `.obvious/skills/mattpocock/`

- **Upstream:** https://github.com/mattpocock/skills (branch `main`)
- **Copied from commit:** `74ca5fe077456a0b3b2f5310cf9430999fd0b5fd`
- **License:** MIT — see `.obvious/skills/mattpocock/LICENSE` (copy of upstream `LICENSE`)
- **Included:** `grill-with-docs`, `grilling` (stated dependency of `grill-with-docs`), `handoff` — each skill's `SKILL.md`.
- **Excluded:** each skill's upstream `agents/openai.yaml` runtime manifest (agent-runtime specific, not needed for skill content).
- **Known dangling references:**
  - `grill-with-docs/SKILL.md` instructs calling the `domain-modeling` skill, which is not vendored (outside the curated set). The `grilling` dependency is vendored and resolves.

### 2. michael-denyer/pstack-claude — `.obvious/skills/pstack/`

- **Upstream:** https://github.com/michael-denyer/pstack-claude (canonical Claude Code port of Lauren Tan's pstack; branch `main`)
- **Copied from commit:** `3cc1b80687b7c6af028f263afe01fea4d95ae729`
- **License:** MIT — two upstream license files copied:
  - `.obvious/skills/pstack/LICENSE` — MIT, Copyright (c) 2026 Lauren Tan (pstack-derived skills, principles, scripts, and the `poteto-agent` and `comment-sicko` definitions)
  - `.obvious/skills/pstack/LICENSE-cursor-team-kit` — MIT, Copyright (c) 2026 Cursor (applies to `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `what-did-i-get-done`)
  - See also upstream `NOTICE-skills.md` for full provenance of the skills-only distribution.
- **Included:** the complete skills tree (54 skill directories, each with its `SKILL.md` plus the skill's own `references/` and `scripts/` where present).
- **Excluded:** runtime-specific files outside the skills tree — upstream `plugins/pstack/hooks/`, `plugins/pstack/agents/`, `plugins/pstack/.claude-plugin/`, `plugins/pstack/.codex-plugin/`, plus repo-level `tools/` and `tests/`.
- **Known dangling references:** references to the excluded runtime paths that remain in vendored prose (left verbatim per the vendoring rule; skills that merely mention these paths are unaffected):
  1. `poteto-mode/references/codex-tools.md` line 38 — mentions reading `poteto-mode/references/agents/comment-sicko.md`, a path under an excluded `agents/` tree (the referenced file is not vendored).

### 3. unslop — `.obvious/skills/unslop/`

- **Source swap:** the preferred source, https://github.com/theclaymethod/unslop (commit `17ed39c9d0b522f44190ff0c6233867eadee192a`), was **rejected during license verification**: its README claims "Licensed MIT" but the repository contains **no LICENSE file** and GitHub reports `license: null`. A README claim without a license file is insufficient for redistribution, so the documented fallback was used instead.
- **Vendored source:** https://github.com/badmuriss/unslop
- **Copied from commit:** `bf0732d33f02ca687ce50aaaab4237dce6ff0a55`
- **License:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) — see `.obvious/skills/unslop/LICENSE` (copy of upstream `LICENSE`).
- **Included:** `SKILL.md`, `references/`, `LICENSE`.
- **Excluded:** upstream `eval.md`, `docs/`, `evals/` (evaluation harness material, not skill content).

## Verification

- `scripts/lint-skills` validates that every vendored `SKILL.md` has YAML
  frontmatter with non-empty `name` and `description`, and that cross-references
  between vendored skills resolve. Run it from the repository root:
  `./scripts/lint-skills`
