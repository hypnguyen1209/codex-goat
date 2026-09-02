import assert from "node:assert/strict";
import { test } from "node:test";
import { GOAT_HOOK_EVENTS, type HooksFile, installHooks, uninstallHooks } from "../setup/hooks-file.js";

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

test("SessionStart matches startup, resume, and clear", () => {
  const installed = installHooks(null, COMMAND);
  assert.equal(installed.hooks?.SessionStart?.[0]?.matcher, "startup|resume|clear");
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

test("uninstall preserves unrelated top-level keys", () => {
  const withExtras: HooksFile = { ...installHooks(null, COMMAND), $schema: "https://example.com/schema.json" };
  const removed = uninstallHooks(withExtras);
  assert.equal(removed?.$schema, "https://example.com/schema.json");
  assert.equal(removed?.hooks, undefined);
});
