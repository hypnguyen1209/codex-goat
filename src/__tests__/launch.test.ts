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
