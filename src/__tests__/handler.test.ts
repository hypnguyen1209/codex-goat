import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir } from "../core/fsx.js";
import { detectStage, handleHook, runHookFromStdin } from "../hooks/handler.js";
import { updateStage } from "../state/store.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-hook-"));

beforeEach(() => {
  process.env.GOAT_ROOT = join(sandbox, `run-${Math.random().toString(36).slice(2)}`);
  ensureDir(process.env.GOAT_ROOT);
});

after(() => {
  delete process.env.GOAT_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

test("detects a stage from $, /, and bare spellings", () => {
  assert.equal(detectStage("$ultraqa run the suite"), "ultraqa");
  assert.equal(detectStage("/code-review please"), "code-review");
  assert.equal(detectStage("plan the migration"), "plan");
});

test("does not invent a stage from ordinary prose", () => {
  assert.equal(detectStage("can you look at the router"), null);
  assert.equal(detectStage("$unknown-thing"), null);
});

test("SessionStart with no state produces no context", () => {
  assert.deepEqual(handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }), {});
});

test("SessionStart surfaces in-flight stages and the objective", () => {
  updateStage("plan", { status: "active", objective: "ship checkout fix" });
  const output = handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() });
  const context = output.hookSpecificOutput?.additionalContext ?? "";
  assert.equal(output.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.match(context, /ship checkout fix/);
  assert.match(context, /\$plan: active/);
});

test("SessionStart flags a completed stage that recorded no evidence", () => {
  updateStage("ultragoal", { status: "complete" });
  const context = handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }).hookSpecificOutput
    ?.additionalContext;
  assert.match(context ?? "", /NO EVIDENCE RECORDED/);
});

test("UserPromptSubmit attaches the entry contract for the invoked stage", () => {
  const output = handleHook({
    hook_event_name: "UserPromptSubmit",
    cwd: process.cwd(),
    prompt: "$ultraqa prove the CLI works",
  });
  const context = output.hookSpecificOutput?.additionalContext ?? "";
  assert.match(context, /entry contract for \$ultraqa/);
  assert.match(context, /runnable:/);
  assert.match(context, /Stages are independent/);
});

test("UserPromptSubmit stays quiet for a prompt that names no stage", () => {
  const output = handleHook({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "hello" });
  assert.deepEqual(output, {});
});

test("an unknown event returns an empty response", () => {
  assert.deepEqual(handleHook({ hook_event_name: "PreToolUse", cwd: process.cwd() }), {});
});

test("malformed stdin never throws and never blocks", () => {
  assert.equal(runHookFromStdin("not json at all"), "{}");
  assert.equal(runHookFromStdin(""), "{}");
});

test("the response never contains a block decision", () => {
  const raw = runHookFromStdin(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "$plan x" }),
  );
  assert.ok(!raw.includes('"decision"'), "hook must never be able to block a turn");
});
