import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Filesystem helpers with the durability properties the state store needs. */

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Write via a temp file in the same directory then rename, so a reader never
 * observes a half-written JSON document. Hooks and the CLI race constantly.
 */
export function writeFileAtomic(file: string, contents: string): void {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${Date.now()}-${process.pid}.tmp`);
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * A byte-order mark makes `JSON.parse` throw, and Windows editors write one without
 * saying so. Every JSON read here strips it first, so a file a user edited in Notepad
 * is not mistaken for a corrupt one.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(stripBom(readFileSync(file, "utf8"))) as T;
  } catch {
    return fallback;
  }
}

/**
 * Read JSON while keeping "not there" and "there but unreadable" apart.
 *
 * `readJson` collapses both into its fallback, which is right for a cache and wrong for a
 * file another tool owns: `goat setup` rewrote an unparseable `hooks.json` from scratch
 * and `goat uninstall` deleted one, reporting it as "contained only goat hooks". Both
 * destroyed hooks belonging to other tools. Callers that write back to a shared file must
 * use this and refuse to touch `invalid`.
 */
export type JsonRead<T> = { kind: "missing" } | { kind: "invalid"; reason: string } | { kind: "ok"; value: T };

export function readJsonFile<T>(file: string): JsonRead<T> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { kind: "missing" };
  }
  try {
    return { kind: "ok", value: JSON.parse(stripBom(raw)) as T };
  } catch (error) {
    return { kind: "invalid", reason: (error as Error).message };
  }
}

/** Append one JSON object as a line. Appends of <4KB are atomic enough on all target platforms. */
export function appendJsonl(file: string, value: unknown): void {
  ensureDir(dirname(file));
  appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(file: string, limit = Number.POSITIVE_INFINITY): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const slice = Number.isFinite(limit) ? lines.slice(-limit) : lines;
  const out: T[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A truncated tail line is expected if a writer was killed mid-append.
    }
  }
  return out;
}
