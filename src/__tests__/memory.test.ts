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
  assert.ok(!/basically/i.test(output), "adverbial filler kept");
  // "I will" survives on purpose — see FILLER in src/state/memory.ts.
  assert.ok(output.includes("I will"), "subject-verb opener was stripped");
});

// Regression: the v0.1.2 filler list carried subject-verb openers and hedges, which
// changed what a sentence asserts. "I think X" -> "X" turns a hedge into a claim, which is
// exactly the false confidence this project exists to prevent.
test("phrases that carry meaning are never stripped", () => {
  for (const input of [
    "let me know if you want the key surfaced",
    "I think the fix works",
    "I will let me down",
    "it seems that the flake is timing-related",
    "the reason why it failed is a missing dep",
  ]) {
    assert.equal(compress(input), input, "meaning-bearing text was altered");
  }
});

// Regression: the punctuation repair deleted the space before ANY dot, so a recorded
// command came back unrunnable.
test("a recorded command stays runnable", () => {
  assert.equal(compress("run ./scripts/ci.sh now"), "run ./scripts/ci.sh now");
  assert.equal(compress("cd .. then build"), "cd .. then build");
  assert.equal(compress("edit ./src/a.ts and ../b.ts"), "edit ./src/a.ts and ../b.ts");
  // A dot that really ends a clause still closes up.
  assert.equal(compress("it works . next thing"), "it works. next thing");
});

// Regression: the final whitespace collapse ran over the joined string, reaching into
// protected spans and flattening recorded test output onto one line.
test("layout inside a fenced block is preserved", () => {
  const fence = "```";
  const output = compress(`output:\n${fence}\nnpm test\nFAIL a.ts:12\n${fence}\ndone`);
  assert.ok(output.includes(`${fence}\nnpm test\nFAIL a.ts:12\n${fence}`), `fence flattened: ${output}`);
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

// Regression: stripFiller broke out of the phrase loop on the first hit and capped at 3
// rounds, so a sentence containing ten filler phrases kept seven of them.
test("every adverbial filler occurrence is stripped, not just the first three", () => {
  const output = compress("basically actually essentially obviously of course we should fix it");
  for (const filler of ["basically", "actually", "essentially", "obviously", "of course"]) {
    assert.ok(!output.toLowerCase().includes(filler.toLowerCase()), `"${filler}" survived: ${output}`);
  }
  assert.equal(output, "we should fix it");
});

test("repeated occurrences of one phrase are all removed", () => {
  assert.equal(compress("of course of course of course of course of course stop"), "stop");
});

test("compression terminates on adversarial input", () => {
  assert.equal(compress("of course ".repeat(200)).length, 0);
  assert.ok(compress("a".repeat(5000)).length === 5000);
});

// Regression: agents repeat themselves. A measured mid-project session emitted eight
// byte-identical lines — 76% of the SessionStart injection saying one thing eight times.
test("the digest drops duplicate observations", () => {
  for (let i = 0; i < 10; i += 1) {
    recordObservation({ sessionId: "s", kind: "result", text: "tests pass and lint is clean" });
  }
  recordObservation({ sessionId: "s", kind: "result", text: "pushed to main" });
  const digest = memoryDigest(8) ?? "";
  const repeated = digest.split("\n").filter((line) => line.includes("tests pass")).length;
  assert.equal(repeated, 1, `duplicate kept ${repeated} times:\n${digest}`);
  assert.ok(digest.includes("pushed to main"), "the distinct entry was dropped");
});

test("dedup frees room for older distinct entries", () => {
  recordObservation({ sessionId: "s", kind: "note", text: "oldest distinct thing" });
  for (let i = 0; i < 12; i += 1) {
    recordObservation({ sessionId: "s", kind: "result", text: "same message" });
  }
  const digest = memoryDigest(8) ?? "";
  assert.ok(digest.includes("oldest distinct thing"), `over-read did not reach it:\n${digest}`);
});

test("the same text under different kinds is not deduplicated", () => {
  recordObservation({ sessionId: "s", kind: "prompt", text: "run the suite" });
  recordObservation({ sessionId: "s", kind: "result", text: "run the suite" });
  const digest = memoryDigest(8) ?? "";
  assert.ok(digest.includes("[prompt] run the suite"));
  assert.ok(digest.includes("[result] run the suite"));
});
