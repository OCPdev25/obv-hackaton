/** Minimal --key=value / --key CLI arg parser. */
export function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue
    const eq = raw.indexOf("=")
    if (eq === -1) out[raw.slice(2)] = true
    else out[raw.slice(2, eq)] = raw.slice(eq + 1)
  }
  return out
}
