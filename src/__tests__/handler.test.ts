import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ensureDir, writeJsonAtomic } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import { detectStage, handleHook, runHookFromStdin } from "../hooks/handler.js";
import { recentObservations } from "../state/memory.js";
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

test("detects a stage from the $ and / spellings", () => {
  assert.equal(detectStage("$ultraqa run the suite"), "ultraqa");
  assert.equal(detectStage("/code-review please"), "code-review");
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
  assert.match(context ?? "", /UNPROVEN — no evidence recorded/);
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

// Regression: detectStage matched a bare leading word, so ordinary prose was treated as a
// stage invocation — which also paid for the contract report's `git status` probe.
test("ordinary prose is not treated as a stage invocation", () => {
  for (const prompt of [
    "plan the migration",
    "team review this",
    "clarify what you meant",
    "review the code-review process",
    "can you plan this out",
  ]) {
    assert.equal(detectStage(prompt), null, `${JSON.stringify(prompt)} fired a stage`);
  }
});

test("an explicit sigil is still detected anywhere in the prompt", () => {
  assert.equal(detectStage("$plan the migration"), "plan");
  assert.equal(detectStage("please run /ultraqa on this"), "ultraqa");
  assert.equal(detectStage("first $code-review then ship"), "code-review");
});

test("UserPromptSubmit stays silent — and spawns no subprocess — for ordinary prose", () => {
  assert.deepEqual(
    handleHook({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "plan the migration" }),
    {},
  );
});

// $ultragoal, not $plan: the no-op message belongs to stages proven by a command. A plan
// is proven by its artifact, so a no-op there is not the interesting failure.
test("SessionStart reports why a completed execution stage is unproven", () => {
  updateStage("ultragoal", { status: "complete", evidence: [{ command: "true", exitCode: 0, at: "t" }] });
  const context =
    handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }).hookSpecificOutput?.additionalContext ?? "";
  assert.match(context, /UNPROVEN — every recorded command is a shell no-op/);
});

// The sentence explains what to do about an `inline` requirement. $clarify has no
// requirements at all, so it used to print under "- no prerequisites", naming a category
// the stage cannot have and an earlier stage that does not exist.
test("the independence note is attached only when a requirement is actually inline", () => {
  // $plan needs an objective and no state has been written, so it reports inline.
  const withInline =
    handleHook({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "$plan the migration" })
      .hookSpecificOutput?.additionalContext ?? "";
  assert.match(withInline, /- objective: inline/);
  assert.match(withInline, /Stages are independent/);

  const noRequirements =
    handleHook({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "$clarify what do you mean" })
      .hookSpecificOutput?.additionalContext ?? "";
  assert.match(noRequirements, /entry contract for \$clarify/);
  assert.match(noRequirements, /- no prerequisites/);
  assert.doesNotMatch(noRequirements, /Stages are independent/);
});

test("SessionStart reports a document stage whose artifact was never written", () => {
  updateStage("plan", { status: "complete", artifact: ".goat/plans/ghost.md" });
  const context =
    handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }).hookSpecificOutput?.additionalContext ?? "";
  assert.match(context, /UNPROVEN — artifact recorded but missing on disk/);
});

function sessionStart(): string {
  return handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }).hookSpecificOutput?.additionalContext ?? "";
}

function writeConfig(memory: Record<string, unknown>): void {
  writeJsonAtomic(goatPaths(process.env.GOAT_ROOT ?? process.cwd()).config, { version: 1, memory });
}

// `goat setup` has written memory.enabled / digestSize since 0.1.0; until 0.1.6 nothing read them.
test("memory.enabled=false stops recording and injection in the same runtime", () => {
  writeConfig({ enabled: false });
  handleHook({ hook_event_name: "Stop", cwd: process.cwd(), last_assistant_message: "remember me" });
  handleHook({ hook_event_name: "UserPromptSubmit", cwd: process.cwd(), prompt: "and me" });
  assert.equal(recentObservations(10, process.cwd()).length, 0, "an observation was recorded with memory off");
  assert.doesNotMatch(sessionStart(), /Recent session memory/);
});

test("digestSize bounds the digest", () => {
  writeConfig({ enabled: true, digestSize: 2 });
  for (const text of ["first thing", "second thing", "third thing"]) {
    handleHook({ hook_event_name: "Stop", cwd: process.cwd(), last_assistant_message: text });
  }
  const context = sessionStart();
  assert.doesNotMatch(context, /first thing/);
  assert.match(context, /second thing/);
  assert.match(context, /third thing/);
});

test("GOAT_MEMORY=off wins over the config file", () => {
  writeConfig({ enabled: true });
  process.env.GOAT_MEMORY = "off";
  try {
    handleHook({ hook_event_name: "Stop", cwd: process.cwd(), last_assistant_message: "silenced" });
    assert.equal(recentObservations(10, process.cwd()).length, 0);
  } finally {
    delete process.env.GOAT_MEMORY;
  }
});

// A stage still in flight carries its failures with it, so the three-failures rule in
// AGENTS.md survives a restart instead of starting over at zero.
test("SessionStart shows failing commands on an in-flight stage, and how old the state is", () => {
  updateStage("ultragoal", {
    status: "active",
    evidence: [
      { command: "npm test", exitCode: 1, at: "t" },
      { command: "npm test", exitCode: 1, at: "t" },
    ],
  });
  const context = sessionStart();
  assert.match(context, /\$ultragoal: active — 2 failing command\(s\), last: npm test -> exit 1/);
  assert.match(context, /Last codex-goat activity: moments ago \(/);
  assert.doesNotMatch(context, /confirm it is still current/);
});

test("state older than a week asks for confirmation before resuming", () => {
  updateStage("plan", { status: "active", objective: "old goal" });
  const file = goatPaths(process.env.GOAT_ROOT ?? process.cwd()).stateFile;
  const state = JSON.parse(readFileSync(file, "utf8"));
  state.updatedAt = new Date(Date.now() - 14 * 86_400_000).toISOString();
  writeFileSync(file, JSON.stringify(state));
  const context = sessionStart();
  assert.match(context, /Last codex-goat activity: 14 days ago/);
  assert.match(context, /confirm it is still current before resuming/);
});

test("no staleness line when nothing was rehydrated", () => {
  assert.deepEqual(handleHook({ hook_event_name: "SessionStart", cwd: process.cwd() }), {});
});

// Codex spills any hook context over ~2,500 tokens to disk and injects a preview instead,
// which would take the objective and stage list down with an oversized notes file.
test("SESSION.md is capped under the spill limit and points at the file", () => {
  // GOAT_ROOT stands in for `.goat/` itself, so the notes file lives directly under it.
  const goat = goatPaths(process.env.GOAT_ROOT ?? process.cwd()).root;
  ensureDir(goat);
  writeFileSync(join(goat, "SESSION.md"), "x".repeat(6_000));
  const context = sessionStart();
  assert.ok(context.length < 5_000, `not capped: ${context.length} chars`);
  assert.match(context, /truncated; read \.goat\/SESSION\.md for the rest/);
});

// $team spawns one sub-agent per lane. Each lane's brief arrives as a UserPromptSubmit
// carrying agent_id; it is neither a user prompt to remember nor a stage to contract.
test("UserPromptSubmit inside a spawned sub-agent records nothing and attaches nothing", () => {
  const output = handleHook({
    hook_event_name: "UserPromptSubmit",
    cwd: process.cwd(),
    prompt: "$plan lane brief for L2",
    agent_id: "agent-42",
    // Codex sends the spawn role name here, "default" when none was given.
    agent_type: "default",
  });
  assert.deepEqual(output, {});
  assert.equal(recentObservations(10, process.cwd()).length, 0, "a lane brief was recorded as a prompt");
});
