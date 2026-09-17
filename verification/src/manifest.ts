/**
 * Extract verification manifests from PR surfaces (body + comments).
 *
 * Recording format (append-only; the latest block across body and comments,
 * oldest → newest, wins):
 *
 *     <!-- verification-manifest:v1 -->
 *     ```json
 *     { ...manifest... }
 *     ```
 *
 * Manifest authoring/recording tooling is owned by the workers recording
 * evidence; this module only parses the convention for the validator.
 */

export const MANIFEST_MARKER = 'verification-manifest:v1'

const BLOCK_RE = /<!--\s*verification-manifest:v1\s*-->\s*```json[^\S\n]*\n?([\s\S]*?)```/g

export type ExtractedManifest =
  | { ok: true; raw: unknown; source: string; index: number }
  | { ok: false; error: string; source: string; index: number }

/** Pull every manifest block out of one text surface, in order of appearance. */
export function extractManifests(text: string, source: string): Array<ExtractedManifest> {
  const out: Array<ExtractedManifest> = []
  for (const match of text.matchAll(BLOCK_RE)) {
    const json = match[1]
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (err) {
      out.push({ ok: false, error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`, source, index: out.length })
      continue
    }
    out.push({ ok: true, raw: parsed, source, index: out.length })
  }
  return out
}

/**
 * Latest manifest across surfaces, in recording order (body first, then
 * comments oldest → newest). A later unparseable block supersedes earlier
 * valid ones — an invalid latest manifest must fail loudly, not fall back.
 */
export function latestManifest(blocks: Array<ExtractedManifest>): ExtractedManifest | undefined {
  return blocks.length === 0 ? undefined : blocks[blocks.length - 1]
}
