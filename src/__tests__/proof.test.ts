import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import { stateFileProblem, unprovenReason, updateStage } from "../state/store.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-proof-"));
let root = "";

beforeEach(() => {
  root = join(sandbox, `run-${Math.random().toString(36).slice(2)}`);
  process.env.GOAT_ROOT = root;
  ensureDir(root);
});

after(() => {
  delete process.env.GOAT_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

// Existence is not content. `: > plan.md` followed by `--artifact plan.md` closed $plan
// green until 0.1.6, and agency-continuity-audit's content-level checks were the reminder.
test("an empty artifact does not prove a document stage", () => {
  writeFileSync(join(root, "plan.md"), "");
  const state = updateStage("plan", { status: "complete", artifact: "plan.md" });
  assert.match(unprovenReason(state.stages.plan, "plan", root) ?? "", /empty on disk: plan\.md/);

  writeFileSync(join(root, "plan.md"), "# plan\n");
  assert.equal(unprovenReason(state.stages.plan, "plan", root), null);
});

test("a missing artifact is still reported as missing, not empty", () => {
  const state = updateStage("plan", { status: "complete", artifact: "ghost.md" });
  assert.match(unprovenReason(state.stages.plan, "plan", root) ?? "", /missing on disk/);
});

// readState repairs a corrupt file silently so a session is never blocked. The CLI must
// still say so: until 0.1.6 `{not json` made every stage idle with exit 0 and doctor passed.
test("a corrupt state file is reported, an absent or valid one is not", () => {
  assert.equal(stateFileProblem(root), null, "no file yet");

  updateStage("plan", { status: "active" });
  assert.equal(stateFileProblem(root), null, "valid file");

  writeFileSync(goatPaths(root).stateFile, "{not json");
  assert.match(stateFileProblem(root) ?? "", /not valid JSON/);

  writeFileSync(goatPaths(root).stateFile, "[1,2,3]");
  assert.match(stateFileProblem(root) ?? "", /not a JSON object/);
});
