import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { checkContract } from "../state/contract.js";
import { normalizeStageId, STAGE_IDS, STAGES } from "../state/stages.js";
import { updateStage } from "../state/store.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-contract-"));

beforeEach(() => {
  process.env.GOAT_ROOT = join(sandbox, `run-${Math.random().toString(36).slice(2)}`);
  ensureDir(process.env.GOAT_ROOT);
});

after(() => {
  delete process.env.GOAT_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

test("normalizes every spelling users type", () => {
  assert.equal(normalizeStageId("plan"), "plan");
  assert.equal(normalizeStageId("$ultraqa"), "ultraqa");
  assert.equal(normalizeStageId("/code-review"), "code-review");
  assert.equal(normalizeStageId("--team"), "team");
  assert.equal(normalizeStageId("nonsense"), null);
});

test("$clarify has no prerequisites and is always ready", () => {
  const report = checkContract("clarify");
  assert.equal(report.checks.length, 0);
  assert.equal(report.ready, true);
});

test("no stage is ever hard-blocked — unmet requirements are inline, not missing", () => {
  for (const stage of STAGE_IDS) {
    const report = checkContract(stage);
    assert.equal(report.ready, true, `${stage} reported not ready, which would break independent invocation`);
    for (const check of report.checks) {
      assert.notEqual(check.verdict, "missing", `${stage}/${check.requirement} is hard-blocked`);
    }
  }
});

test("a recorded objective satisfies the objective requirement", () => {
  const before = checkContract("plan").checks.find((check) => check.requirement === "objective");
  assert.equal(before?.verdict, "inline");

  updateStage("plan", { objective: "ship the fix" });
  const after = checkContract("plan").checks.find((check) => check.requirement === "objective");
  assert.equal(after?.verdict, "satisfied");
  assert.match(after?.detail ?? "", /ship the fix/);
});

test("a plan marked complete but with no artifact on disk is not treated as satisfied", () => {
  updateStage("plan", { status: "complete", artifact: ".goat/plans/does-not-exist.md" });
  const check = checkContract("ultragoal").checks.find((requirement) => requirement.requirement === "plan");
  assert.equal(check?.verdict, "inline");
  assert.match(check?.detail ?? "", /missing on disk/);
});

test("every stage suggests its usual predecessor when input is missing", () => {
  const report = checkContract("ultragoal");
  assert.ok(report.suggestion?.includes(STAGES.plan.invocation));
});

test("the stage table and the invocation names stay in sync", () => {
  for (const stage of STAGE_IDS) {
    assert.equal(STAGES[stage].invocation, `$${stage}`);
    assert.equal(STAGES[stage].id, stage);
  }
});
