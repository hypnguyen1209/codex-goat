import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOAT_HOOK_EVENTS,
  type HooksFile,
  SESSION_START_MATCHER,
  installHooks,
  uninstallHooks,
  unsupportedTopLevelKeys,
} from "../setup/hooks-file.js";

const COMMAND = 'node "/pkg/hooks/goat-hook.mjs"';

const foreignHook: HooksFile = {
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "node /other/tool.js" }] }],
    PreToolUse: [{ hooks: [{ type: "command", command: "node /other/guard.js" }] }],
  },
};

test("registers every goat event", () => {
  const installed = installHooks(null, COMMAND);
  for (const event of GOAT_HOOK_EVENTS) {
    assert.ok(installed.hooks?.[event]?.length, `${event} not registered`);
  }
});

test("preserves hooks owned by other tools", () => {
  const installed = installHooks(foreignHook, COMMAND);
  assert.equal(installed.hooks?.PreToolUse?.length, 1, "foreign PreToolUse hook was dropped");
  assert.equal(installed.hooks?.SessionStart?.length, 2, "foreign SessionStart hook was replaced");
});

test("reinstalling does not duplicate goat entries", () => {
  const once = installHooks(foreignHook, COMMAND);
  const twice = installHooks(once, COMMAND);
  const goatEntries = (twice.hooks?.SessionStart ?? []).filter((group) =>
    group.hooks.some((hook) => hook.command.includes("goat-hook.mjs")),
  );
  assert.equal(goatEntries.length, 1);
});

test("SessionStart carries the full source list as its matcher", () => {
  const installed = installHooks(null, COMMAND);
  assert.equal(installed.hooks?.SessionStart?.[0]?.matcher, SESSION_START_MATCHER);
});

test("Stop carries a timeout so memory writes are not cut off", () => {
  const installed = installHooks(null, COMMAND);
  assert.equal(installed.hooks?.Stop?.[0]?.hooks[0]?.timeout, 15);
});

test("uninstall removes only goat entries", () => {
  const removed = uninstallHooks(installHooks(foreignHook, COMMAND));
  assert.equal(removed?.hooks?.PreToolUse?.length, 1);
  assert.equal(removed?.hooks?.SessionStart?.length, 1);
  assert.ok(!removed?.hooks?.SessionStart?.[0]?.hooks[0]?.command.includes("goat-hook.mjs"));
  assert.ok(!removed?.hooks?.UserPromptSubmit, "empty event key should be dropped");
});

test("uninstall returns null when the file held nothing but goat hooks", () => {
  assert.equal(uninstallHooks(installHooks(null, COMMAND)), null);
});

test("the allowed top-level key survives install and uninstall", () => {
  const described: HooksFile = { description: "my hooks", ...installHooks(null, COMMAND) };
  assert.equal(installHooks(described, COMMAND).description, "my hooks");
  assert.equal(uninstallHooks(described)?.description, "my hooks");
});

// Regression: HooksFile once had a `[key: string]: unknown` index signature and spread
// unknown keys forward "to preserve foreign content". Codex parses hooks.json with
// deny_unknown_fields, so a preserved `$schema` makes the file unparseable and disables
// EVERY hook in it — the user's included. The old test asserted that behavior.
test("an unknown top-level key is reported and not written back", () => {
  const withSchema = { $schema: "https://example.com/s.json", ...installHooks(null, COMMAND) };
  assert.deepEqual(unsupportedTopLevelKeys(withSchema), ["$schema"]);

  const installed = installHooks(withSchema as HooksFile, COMMAND);
  assert.ok(!("$schema" in installed), "an unknown key was forwarded into hooks.json");
  assert.deepEqual(unsupportedTopLevelKeys(installed), []);
  assert.deepEqual(unsupportedTopLevelKeys(uninstallHooks(installed) ?? {}), []);
});

test("a clean file reports no unsupported keys", () => {
  assert.deepEqual(unsupportedTopLevelKeys(installHooks(null, COMMAND)), []);
  assert.deepEqual(unsupportedTopLevelKeys({ description: "x", hooks: {} }), []);
  assert.deepEqual(unsupportedTopLevelKeys(null), []);
});

// Regression: the matcher is an exact alternation list, not a regex. Omitting `compact`
// meant the session digest was never re-injected after a compaction.
test("SessionStart matches all four sources, including compact", () => {
  const matcher = installHooks(null, COMMAND).hooks?.SessionStart?.[0]?.matcher ?? "";
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.ok(matcher.split("|").includes(source), `${source} is not matched: ${matcher}`);
  }
});
