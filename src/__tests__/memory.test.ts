import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { compress, memoryDigest, recentObservations, recordObservation, redact } from "../state/memory.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-memory-"));

beforeEach(() => {
  process.env.GOAT_ROOT = join(sandbox, `run-${Math.random().toString(36).slice(2)}`);
  ensureDir(process.env.GOAT_ROOT);
});

after(() => {
  delete process.env.GOAT_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

test("code spans, paths, URLs, and versions survive byte-for-byte", () => {
  const output = compress("I will basically update `useMemo` in src/app/page.tsx to fix v1.2.3");
  assert.ok(output.includes("`useMemo`"));
  assert.ok(output.includes("src/app/page.tsx"));
  assert.ok(output.includes("v1.2.3"));
  assert.ok(!/i will/i.test(output));
});

test("filler is not stripped from inside a word", () => {
  assert.ok(compress("The claim is factually correct").includes("factually"));
});

test("private spans never reach the compressor output", () => {
  assert.equal(redact("a <private>sk-secret</private> b"), "a [redacted] b");
  assert.equal(redact("a <private>unterminated"), "a [redacted]");
});

test("recording redacts, compresses, and reads back", () => {
  recordObservation({ sessionId: "s1", kind: "prompt", text: "Let me fix <private>hunter2</private> now" });
  const recent = recentObservations(5);
  assert.equal(recent.length, 1);
  assert.ok(!recent[0]?.text.includes("hunter2"));
  assert.ok(recent[0]?.text.includes("[redacted]"));
});

test("an observation that compresses to nothing is not written", () => {
  assert.equal(recordObservation({ sessionId: "s1", kind: "note", text: "   " }), null);
  assert.equal(recentObservations(5).length, 0);
});

test("the digest lists the most recent observations last", () => {
  recordObservation({ sessionId: "s1", kind: "prompt", text: "first thing" });
  recordObservation({ sessionId: "s1", kind: "result", text: "second thing" });
  const digest = memoryDigest(5) ?? "";
  assert.ok(digest.indexOf("first thing") < digest.indexOf("second thing"));
});

test("no digest when nothing has been recorded", () => {
  assert.equal(memoryDigest(5), null);
});

// The native hook path (crates/goat-runtime) must compress identically, or a session's
// memory would depend on whether the Rust binary happened to be built.
test("matches the shared compression fixture used by the native runtime", () => {
  const fixturePath = join(
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    "crates",
    "goat-runtime",
    "tests",
    "fixtures",
    "compress.json",
  );
  const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{ input: string; expected: string }>;
  assert.ok(cases.length > 0, "fixture is empty");
  for (const testCase of cases) {
    assert.equal(compress(testCase.input), testCase.expected, `diverged on: ${testCase.input}`);
  }
});
