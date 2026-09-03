import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import { appendLedger, readLedger } from "../state/ledger.js";
import { STAGE_IDS, STAGES } from "../state/stages.js";
import {
  clearState,
  type EvidenceRef,
  isSubstantiveEvidence,
  readState,
  unprovenReason,
  updateStage,
} from "../state/store.js";

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

// Regression: v0.1.0 stored `exitCode`, wrote it to the ledger, and printed it — but no
// predicate ever compared it to 0, so `goat ledger evidence --exit 1 -- npm test` (a
// FAILING test) satisfied the evidence gate and `goat status` exited 0.
test("a failing command does not back a completion claim", () => {
  updateStage("plan", { status: "complete", evidence: [{ command: "npm test", exitCode: 1, at: "t" }] });
  const stage = readState().stages.plan;
  assert.equal(isSubstantiveEvidence(stage.evidence[0] as EvidenceRef), false);
  assert.match(unprovenReason(stage) ?? "", /every recorded command failed/);
});

test("a shell no-op does not back a completion claim", () => {
  for (const command of ["true", ":", "echo done", "  exit 0", "printf ok"]) {
    assert.equal(isSubstantiveEvidence({ command, exitCode: 0, at: "t" }), false, `${command} was accepted`);
  }
});

test("a real command that exited 0 does back the claim", () => {
  for (const command of ["npm test", "cargo test -p goat-runtime", "./scripts/check.sh"]) {
    assert.equal(isSubstantiveEvidence({ command, exitCode: 0, at: "t" }), true, `${command} was rejected`);
  }
  updateStage("ultraqa", { status: "complete", evidence: [{ command: "npm test", exitCode: 0, at: "t" }] });
  assert.equal(unprovenReason(readState().stages.ultraqa), null);
});

test("one passing command is enough even alongside failures", () => {
  updateStage("team", {
    status: "complete",
    evidence: [
      { command: "npm test", exitCode: 1, at: "t1" },
      { command: "npm test", exitCode: 0, at: "t2" },
    ],
  });
  assert.equal(unprovenReason(readState().stages.team), null);
});

test("an empty command is never proof", () => {
  assert.equal(isSubstantiveEvidence({ command: "   ", exitCode: 0, at: "t" }), false);
});

test("a stage with no evidence reports why", () => {
  updateStage("clarify", { status: "complete" });
  assert.equal(unprovenReason(readState().stages.clarify), "no evidence recorded");
});

// Regression: three of six skills close with `state set --status complete` and no
// evidence call, because there is no command that makes a plan true. v0.1.4 demanded one
// anyway, so a by-the-book $plan run printed `complete*` and `goat status` exited 1 —
// the project's own gate failing its own instructions.
test("a document stage is proven by its artifact existing", () => {
  const root = process.env.GOAT_ROOT as string;
  writeFileSync(join(root, "plan.md"), "# plan", "utf8");
  updateStage("plan", { status: "complete", artifact: "plan.md" });
  assert.equal(unprovenReason(readState().stages.plan, "plan", root), null);
});

test("a document stage with no artifact at all is still unproven", () => {
  updateStage("clarify", { status: "complete" });
  assert.equal(unprovenReason(readState().stages.clarify, "clarify", process.env.GOAT_ROOT), "no artifact recorded");
});

// Regression: `goat status` printed the artifact path without ever opening it, so a stage
// could report `complete` against a file that was never written.
test("a recorded artifact that is not on disk is never proof", () => {
  const root = process.env.GOAT_ROOT as string;
  updateStage("code-review", {
    status: "complete",
    artifact: ".goat/reviews/ghost.md",
    evidence: [{ command: "npm run lint", exitCode: 0, at: "t" }],
  });
  const reason = unprovenReason(readState().stages["code-review"], "code-review", root);
  assert.match(reason ?? "", /artifact recorded but missing on disk/);
});

test("an execution stage still needs a command, artifact or not", () => {
  const root = process.env.GOAT_ROOT as string;
  writeFileSync(join(root, "goals.md"), "# goals", "utf8");
  updateStage("ultragoal", { status: "complete", artifact: "goals.md" });
  assert.equal(unprovenReason(readState().stages.ultragoal, "ultragoal", root), "no evidence recorded");
  updateStage("ultragoal", { evidence: [{ command: "npm test", exitCode: 0, at: "t" }] });
  assert.equal(unprovenReason(readState().stages.ultragoal, "ultragoal", root), null);
});

test("every stage declares how it is proven", () => {
  for (const id of STAGE_IDS) {
    assert.ok(["artifact", "command"].includes(STAGES[id].proof), `${id} has no proof kind`);
  }
});
