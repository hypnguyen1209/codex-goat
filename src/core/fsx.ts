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

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
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
