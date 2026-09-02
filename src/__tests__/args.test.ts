import assert from "node:assert/strict";
import { test } from "node:test";
import { flagBool, flagString, parseArgs } from "../cli/args.js";

test("recognizes a goat subcommand and its positionals", () => {
  const parsed = parseArgs(["exec", "Reply with exactly GOAT-OK"]);
  assert.equal(parsed.command, "exec");
  assert.deepEqual(parsed.positionals, ["Reply with exactly GOAT-OK"]);
});

test("treats an unknown leading word as a codex prompt, not a command", () => {
  const parsed = parseArgs(["refactor", "the", "router"]);
  assert.equal(parsed.command, null);
  assert.deepEqual(parsed.positionals, ["refactor", "the", "router"]);
});

test("parses --key=value and --key value forms", () => {
  const parsed = parseArgs(["setup", "--scope=user", "--limit", "10"]);
  assert.equal(flagString(parsed.flags, "scope"), "user");
  assert.equal(flagString(parsed.flags, "limit"), "10");
});

test("a value flag followed by another flag stays boolean", () => {
  const parsed = parseArgs(["setup", "--scope", "--force"]);
  assert.equal(parsed.flags.get("scope"), true);
  assert.equal(flagBool(parsed.flags, "force"), true);
});

test("everything after -- is passthrough, even goat's own flags", () => {
  const parsed = parseArgs(["--madmax", "--", "--madmax", "-c", "model=\"gpt-5\""]);
  assert.equal(flagBool(parsed.flags, "madmax"), true);
  assert.deepEqual(parsed.passthrough, ["--madmax", "-c", 'model="gpt-5"']);
});

test("short flags are captured without their dash", () => {
  const parsed = parseArgs(["-w"]);
  assert.equal(parsed.flags.get("w"), true);
});

test("-w takes the following token as its value", () => {
  const parsed = parseArgs(["-w", "feat/task"]);
  assert.equal(flagString(parsed.flags, "w"), "feat/task");
  assert.deepEqual(parsed.positionals, [], "the worktree name must not leak into the codex prompt");
});

// Regression: `--status` was once absent from VALUE_FLAGS, so `--status complete`
// parsed as a boolean and every stage silently recorded as `active`.
test("every flag the CLI reads by value is registered as a value flag", () => {
  const cases: Array<[string[], string, string]> = [
    [["state", "set", "--stage", "plan", "--status", "complete"], "status", "complete"],
    [["state", "set", "--stage", "plan", "--artifact", "a.md"], "artifact", "a.md"],
    [["state", "set", "--stage", "plan", "--objective", "ship it"], "objective", "ship it"],
    [["state", "set", "--stage", "plan", "--summary", "did it"], "summary", "did it"],
    [["ledger", "evidence", "--stage", "plan", "--exit", "1"], "exit", "1"],
    [["ledger", "note", "--stage", "plan", "--note", "hi"], "note", "hi"],
    [["ledger", "read", "--limit", "5"], "limit", "5"],
    [["setup", "--scope", "user"], "scope", "user"],
    [["exec", "--role", "reviewer", "prompt"], "role", "reviewer"],
    [["--effort", "xhigh"], "effort", "xhigh"],
    [["--worktree", "feat/x"], "worktree", "feat/x"],
  ];
  for (const [argv, flag, expected] of cases) {
    const parsed = parseArgs(argv);
    assert.equal(flagString(parsed.flags, flag), expected, `--${flag} did not capture its value`);
  }
});

test("an empty argv yields an empty parse", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, null);
  assert.equal(parsed.flags.size, 0);
  assert.deepEqual(parsed.positionals, []);
  assert.deepEqual(parsed.passthrough, []);
});
