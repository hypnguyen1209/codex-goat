import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import { appendLedger, readLedger } from "../state/ledger.js";
import { clearState, readState, updateStage } from "../state/store.js";

// Every test writes to an isolated GOAT_ROOT so nothing touches the real project state.
const sandbox = mkdtempSync(join(tmpdir(), "goat-state-"));

beforeEach(() => {
  process.env.GOAT_ROOT = join(sandbox, `run-${Math.random().toString(36).slice(2)}`);
  ensureDir(process.env.GOAT_ROOT);
});

after(() => {
  delete process.env.GOAT_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

test("a fresh state has every stage idle", () => {
  const state = readState();
  assert.equal(state.objective, null);
  assert.equal(state.stages.plan.status, "idle");
  assert.deepEqual(state.stages.ultraqa.evidence, []);
});

test("updateStage persists status, artifact, and objective", () => {
  updateStage("plan", { status: "complete", artifact: ".goat/plans/x.md", objective: "ship it" });
  const state = readState();
  assert.equal(state.stages.plan.status, "complete");
  assert.equal(state.stages.plan.artifact, ".goat/plans/x.md");
  assert.equal(state.objective, "ship it");
});

test("evidence accumulates instead of replacing", () => {
  updateStage("ultragoal", { evidence: [{ command: "npm test", exitCode: 0, at: "t1" }] });
  updateStage("ultragoal", { evidence: [{ command: "npm run lint", exitCode: 1, at: "t2" }] });
  const evidence = readState().stages.ultragoal.evidence;
  assert.equal(evidence.length, 2);
  assert.equal(evidence[1]?.command, "npm run lint");
});

test("an omitted field is left untouched", () => {
  updateStage("team", { status: "active", summary: "two lanes" });
  updateStage("team", { status: "complete" });
  const stage = readState().stages.team;
  assert.equal(stage.status, "complete");
  assert.equal(stage.summary, "two lanes");
});

test("a corrupt state file degrades to a fresh state rather than throwing", () => {
  const file = goatPaths().stateFile;
  ensureDir(join(file, ".."));
  writeFileSync(file, "{not json", "utf8");
  assert.equal(readState().stages.plan.status, "idle");
});

test("unknown stage keys and bad types in the file are discarded", () => {
  const file = goatPaths().stateFile;
  ensureDir(join(file, ".."));
  writeFileSync(
    file,
    JSON.stringify({ objective: 42, active: "nope", stages: { plan: { status: "weird", evidence: "no" }, ghost: {} } }),
    "utf8",
  );
  const state = readState();
  assert.equal(state.objective, null);
  assert.equal(state.active, null);
  assert.equal(state.stages.plan.status, "idle");
  assert.deepEqual(state.stages.plan.evidence, []);
  assert.ok(!("ghost" in state.stages));
});

test("clearState resets everything", () => {
  updateStage("plan", { status: "complete", objective: "x" });
  clearState();
  assert.equal(readState().objective, null);
  assert.equal(readState().stages.plan.status, "idle");
});

test("the ledger appends and reads back in order", () => {
  appendLedger({ stage: "plan", kind: "start", summary: "one" });
  appendLedger({ stage: "plan", kind: "complete", summary: "two" });
  const entries = readLedger(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.summary, "one");
  assert.equal(entries[1]?.kind, "complete");
});

test("the ledger survives a truncated tail line", () => {
  appendLedger({ stage: "plan", kind: "note", summary: "intact" });
  writeFileSync(goatPaths().ledger, `${JSON.stringify({ ts: "t", stage: "plan", kind: "note", summary: "intact" })}\n{"trunc`, "utf8");
  const entries = readLedger(10);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.summary, "intact");
});
