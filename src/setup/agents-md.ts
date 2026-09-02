export const AGENTS_START = "<!-- GOAT:AGENTS:START -->";
export const AGENTS_END = "<!-- GOAT:AGENTS:END -->";

/**
 * Merge generated guidance into an existing AGENTS.md between sentinel markers.
 *
 * Everything outside the markers is preserved byte-for-byte. A user's own AGENTS.md
 * frequently carries global safety rules; silently replacing it would be a real
 * regression, so the merge is the only supported write path.
 */
export function mergeAgentsSection(existing: string | null, generated: string): string {
  const block = `${AGENTS_START}\n${generated.trim()}\n${AGENTS_END}`;

  if (existing === null || existing.trim().length === 0) {
    return `${block}\n`;
  }

  const start = existing.indexOf(AGENTS_START);
  const end = existing.indexOf(AGENTS_END);

  if (start >= 0 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + AGENTS_END.length);
    return `${before}${block}${after}`;
  }

  // Markers absent (or malformed): append rather than guess where the section belongs.
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block}\n`;
}

export function hasAgentsSection(contents: string): boolean {
  const start = contents.indexOf(AGENTS_START);
  const end = contents.indexOf(AGENTS_END);
  return start >= 0 && end > start;
}

export function stripAgentsSection(contents: string): string {
  const start = contents.indexOf(AGENTS_START);
  const end = contents.indexOf(AGENTS_END);
  if (start < 0 || end <= start) return contents;
  const merged = `${contents.slice(0, start)}${contents.slice(end + AGENTS_END.length)}`;
  return merged.replace(/\n{3,}/g, "\n\n");
}
