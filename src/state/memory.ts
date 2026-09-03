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
 * Every entry here is an adverbial that can be deleted in ANY position without changing
 * what the sentence asserts. That restriction is the whole design, and v0.1.2 did not
 * have it — the list also carried subject-verb openers and hedges, which measurably
 * damaged meaning:
 *
 *   "let me know if you want X"  ->  "know if you want X"     (phrasal verb eaten)
 *   "I will let me down"         ->  "down"                   (sentence destroyed)
 *   "I think the fix works"      ->  "the fix works"          (hedge became an assertion)
 *
 * The last one is the worst: turning "I think" into a bare claim is exactly the kind of
 * false confidence this project exists to prevent. Hedges carry epistemic status, and
 * subject-verb openers carry agency and tense; neither is filler.
 *
 * Narrowing the list cuts the already-small saving (~4% measured) roughly in half. That
 * is the correct trade: the digest is injected into the model's context, and a mangled
 * sentence there is worse than a slightly longer one.
 *
 * Kept byte-identical to `FILLER` in `crates/goat-runtime/src/compress.rs`; the shared
 * fixture proves the two agree.
 */
export const FILLER = [
  "basically ",
  "essentially ",
  "actually ",
  "obviously ",
  "of course ",
  "please note that ",
  "it is worth noting that ",
  "as you can see ",
  "in order to ",
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
      // A ``` fence must be matched before a single backtick, or the opener is read as
      // an empty inline span and the block's newlines fall through to the whitespace
      // collapse — which flattened recorded test output onto one line.
      const isFence = chars[index + 1] === "`" && chars[index + 2] === "`";
      if (isFence) {
        const rest = chars.slice(index + 3).join("");
        const closeAt = rest.indexOf("```");
        if (closeAt >= 0) {
          flush();
          segments.push([true, `\`\`\`${rest.slice(0, closeAt)}\`\`\``]);
          index += 3 + closeAt + 3;
          continue;
        }
      }
      const close = chars.indexOf("`", index + 1);
      if (!isFence && close > index) {
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

/**
 * Compress prose while leaving code, paths, URLs, filenames, and versions untouched.
 *
 * Every transformation happens INSIDE an unprotected segment. v0.1.2 collapsed whitespace
 * over the joined string as a final pass, which reached into protected spans and flattened
 * a recorded ``` block onto one line — so the segmentation guarantee was real for
 * characters but not for layout, and test output lost its structure.
 */
export function compress(input: string): string {
  const out = segment(input)
    .map(([protectedSpan, text]) => {
      if (protectedSpan) return text;
      // Close the gap before punctuation only where it ends a clause: followed by
      // whitespace or end of segment. The unconditional form deleted the space in front
      // of any leading dot, so a recorded command came back unrunnable —
      // "run ./scripts/ci.sh" became "run./scripts/ci.sh". An evidence ledger is
      // worthless if the command it recorded cannot be replayed.
      return collapseWhitespace(stripFiller(text)).replace(/ (?=[.,;:!?](\s|$))/g, "");
    })
    .join("");
  return out.trim();
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

/**
 * The most recent distinct observations, oldest first.
 *
 * Deduplication matters more than it sounds: agents repeat themselves. A measured
 * mid-project session emitted eight byte-identical lines, which was 76% of the whole
 * SessionStart injection saying one thing eight times. Duplicates are dropped oldest-first
 * so the surviving copy keeps its most recent position, and `limit` then counts distinct
 * entries rather than raw rows — the digest carries more information for fewer tokens.
 */
export function memoryDigest(limit = 8, cwd: string = process.cwd()): string | null {
  // Over-read, because duplicates collapse and would otherwise shrink the digest below
  // `limit` distinct entries.
  const recent = recentObservations(limit * 4, cwd);
  if (recent.length === 0) return null;

  const seen = new Set<string>();
  const distinct: Observation[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index] as Observation;
    const key = `${entry.kind} ${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(entry);
    if (distinct.length === limit) break;
  }
  if (distinct.length === 0) return null;

  const lines = distinct.reverse().map((entry) => `- [${entry.kind}] ${entry.text}`);
  return `Recent session memory (most recent last):\n${lines.join("\n")}`;
}
