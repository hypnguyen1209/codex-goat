import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../cli/args.js";
import { buildLaunchPlan } from "../cli/launch.js";

// buildLaunchPlan resolves the codex binary; point it somewhere harmless for these tests.
process.env.GOAT_CODEX_BIN = "codex";

function argsFor(argv: string[]): string[] {
  return buildLaunchPlan(parseArgs(argv), process.cwd()).args;
}

test("injects high reasoning effort by default", () => {
  assert.deepEqual(argsFor([]), ["-c", 'model_reasoning_effort="high"']);
});

test("--xhigh raises the effort", () => {
  assert.ok(argsFor(["--xhigh"]).includes('model_reasoning_effort="xhigh"'));
});

test("--effort wins over the shorthand flags", () => {
  assert.ok(argsFor(["--xhigh", "--effort", "low"]).includes('model_reasoning_effort="low"'));
});

test("--madmax maps to the codex bypass flag", () => {
  assert.ok(argsFor(["--madmax"]).includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("--no-goat-defaults injects nothing", () => {
  assert.deepEqual(argsFor(["--no-goat-defaults"]), []);
});

test("goat-owned flags are never forwarded to codex", () => {
  const args = argsFor(["--madmax", "--xhigh", "--print-argv", "--worktree=x"]);
  for (const owned of ["--xhigh", "--print-argv", "--worktree", "--madmax=x"]) {
    assert.ok(!args.includes(owned), `${owned} leaked into the codex argv`);
  }
});

test("unknown flags are forwarded to codex verbatim", () => {
  const args = argsFor(["--search", "--model", "gpt-5"]);
  assert.ok(args.includes("--search"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-5"));
});

test("the prompt and passthrough land last, in order", () => {
  const args = argsFor(["fix the bug", "--", "--no-alt-screen"]);
  assert.deepEqual(args.slice(-2), ["fix the bug", "--no-alt-screen"]);
});

// A Codex session runs one model, so per-stage routing works by splitting stages across
// sessions that meet through `.goat/`. These pin the precedence rules.
test("--for routes a deliberation stage to the flagship model", () => {
  const args = argsFor(["--for", "plan"]);
  assert.ok(args.includes("-m"), "no model injected");
  assert.equal(args[args.indexOf("-m") + 1], "gpt-5.6-sol");
});

test("--for routes an execution stage to the faster model", () => {
  for (const stage of ["ultragoal", "team", "ultraqa"]) {
    const args = argsFor(["--for", stage]);
    assert.equal(args[args.indexOf("-m") + 1], "gpt-5.6-luna", `${stage} routed wrong`);
  }
});

test("--for accepts the $ and / spellings users type", () => {
  assert.equal(argsFor(["--for", "$plan"])[argsFor(["--for", "$plan"]).indexOf("-m") + 1], "gpt-5.6-sol");
  assert.equal(argsFor(["--for", "/team"])[argsFor(["--for", "/team"]).indexOf("-m") + 1], "gpt-5.6-luna");
});

test("an explicit --model beats the route", () => {
  const args = argsFor(["--for", "plan", "-m", "gpt-5.6-terra"]);
  assert.ok(!args.includes("gpt-5.6-sol"), "route overrode the user's explicit model");
  assert.ok(args.includes("gpt-5.6-terra"));
});

test("an explicit effort flag beats the route and the default", () => {
  assert.ok(argsFor(["--for", "plan", "--low"]).includes('model_reasoning_effort="low"'));
});

test("--for is never forwarded to codex", () => {
  const args = argsFor(["--for", "plan"]);
  assert.ok(!args.includes("--for"), "--for leaked into the codex argv");
  assert.ok(!args.includes("plan"), "the stage name leaked in as a prompt");
});

test("--no-goat-defaults suppresses routing too", () => {
  assert.deepEqual(argsFor(["--for", "plan", "--no-goat-defaults"]), []);
});

test("an unknown stage is rejected rather than silently ignored", () => {
  assert.throws(() => argsFor(["--for", "nonsense"]), /Unknown stage/);
});
