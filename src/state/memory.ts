import { appendJsonl, readJsonl } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";

/**
 * Session memory: a small, local, append-only log of what happened, replayed as a digest
 * at the start of the next session.
 *
 * Deliberately not a vector store. The value here is continuity across `codex` restarts,
 * and that only needs the last N compact lines. Everything stays on disk under `.goat/`.
 */

export interface Observation {
  ts: string;
  sessionId: string;
  kind: "prompt" | "result" | "note";
  text: string;
}

/**
 * Filler phrases removed from unprotected prose, matched case-insensitively.
 *
 * Kept byte-identical to `FILLER` in `crates/goat-runtime/src/compress.rs`. Both
 * implementations are checked against `crates/goat-runtime/tests/fixtures/compress.json`
 * so the native and Node hook paths cannot produce different memory.
 */
export const FILLER = [
  "i will ",
  "i'll ",
  "i am going to ",
  "i can ",
  "i could ",
  "i would ",
  "let me ",
  "let's ",
  "i think ",
  "i believe ",
  "it seems that ",
  "it looks like ",
  "basically ",
  "essentially ",
  "actually ",
  "please note that ",
  "it is worth noting that ",
  "as you can see ",
  "of course ",
  "obviously ",
  "in order to ",
  "the reason why ",
] as const;

function isTokenChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch) || ch === "_" || ch === "-" || ch === "." || ch === "/" || ch === "\\" || ch === ":";
}

/** Paths, URLs, filenames, and version numbers must survive byte-for-byte. */
function isProtectedToken(token: string): boolean {
  if (token.startsWith("http://") || token.startsWith("https://")) return true;
  if (token.includes("/") || token.includes("\\")) return true;
  const dot = token.indexOf(".");
  if (dot > 0) {
    const after = token.slice(dot + 1);
    if (after.length > 0 && !after.startsWith(".")) return true;
  }
  return false;
}

/** Split into `[protected, text]` segments in source order. */
function segment(input: string): Array<[boolean, string]> {
  const chars = Array.from(input);
  const segments: Array<[boolean, string]> = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain.length > 0) {
      segments.push([false, plain]);
      plain = "";
    }
  };

  while (index < chars.length) {
    const ch = chars[index] as string;

    if (ch === "`") {
      const close = chars.indexOf("`", index + 1);
      if (close > index) {
        flush();
        segments.push([true, chars.slice(index, close + 1).join("")]);
        index = close + 1;
        continue;
      }
    }

    if (isTokenChar(ch)) {
      const start = index;
      while (index < chars.length && isTokenChar(chars[index] as string)) index += 1;
      const token = chars.slice(start, index).join("");
      if (isProtectedToken(token)) {
        flush();
        segments.push([true, token]);
      } else {
        plain += token;
      }
      continue;
    }

    plain += ch;
    index += 1;
  }

  flush();
  return segments;
}

/**
 * Remove every filler occurrence, not just the first few.
 *
 * Each pass deletes at most one occurrence and then restarts, because removing a phrase
 * shifts every later index and can expose a new match ("let me actually …"). v0.1.0 broke
 * out of the phrase loop and capped at three passes, so a sentence with ten filler
 * phrases kept seven of them. The bound is now proportional to the work available: every
 * pass that changes anything strictly shortens the string, so this terminates.
 */
function stripFiller(text: string): string {
  let out = text;
  const maxPasses = text.length + 1;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const lower = out.toLowerCase();
    let removedAt = -1;
    let removedLength = 0;

    // Prefer the earliest match in the string so removal order is position-driven and
    // therefore independent of the order phrases happen to appear in FILLER.
    for (const phrase of FILLER) {
      let searchFrom = 0;
      for (;;) {
        const found = lower.indexOf(phrase, searchFrom);
        if (found < 0) break;
        const boundary = found === 0 || !/[\p{L}\p{N}]/u.test(lower[found - 1] as string);
        if (boundary) {
          if (removedAt < 0 || found < removedAt) {
            removedAt = found;
            removedLength = phrase.length;
          }
          break;
        }
        searchFrom = found + phrase.length;
      }
    }

    if (removedAt < 0) break;
    out = out.slice(0, removedAt) + out.slice(removedAt + removedLength);
  }

  return out;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** Compress prose while leaving code, paths, URLs, filenames, and versions untouched. */
export function compress(input: string): string {
  const joined = segment(input)
    .map(([protectedSpan, text]) => (protectedSpan ? text : collapseWhitespace(stripFiller(text))))
    .join("");
  // Repair spacing left behind by removed phrases.
  return collapseWhitespace(joined.replace(/ (?=[.,;:!?])/g, "")).trim();
}

/** `<private>...</private>` never reaches disk. */
export function redact(input: string): string {
  const lower = input.toLowerCase();
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = lower.indexOf("<private>", cursor);
    if (open < 0) break;
    out += input.slice(cursor, open);
    out += "[redacted]";
    const close = lower.indexOf("</private>", open);
    if (close < 0) return out;
    cursor = close + "</private>".length;
  }
  return out + input.slice(cursor);
}

export function recordObservation(
  observation: Omit<Observation, "ts">,
  cwd: string = process.cwd(),
  maxChars = 600,
): Observation | null {
  const text = compress(redact(observation.text)).slice(0, maxChars);
  if (text.length === 0) return null;
  const entry: Observation = { ts: new Date().toISOString(), ...observation, text };
  appendJsonl(goatPaths(cwd).memoryFile, entry);
  return entry;
}

export function recentObservations(limit = 12, cwd: string = process.cwd()): Observation[] {
  return readJsonl<Observation>(goatPaths(cwd).memoryFile, limit).filter(
    (entry): entry is Observation => typeof entry?.text === "string",
  );
}

export function memoryDigest(limit = 8, cwd: string = process.cwd()): string | null {
  const recent = recentObservations(limit, cwd);
  if (recent.length === 0) return null;
  const lines = recent.map((entry) => `- [${entry.kind}] ${entry.text}`);
  return `Recent session memory (most recent last):\n${lines.join("\n")}`;
}
