import assert from "node:assert/strict";
import { test } from "node:test";
import { goatHookKeys, hookTrustReport, trustedHookKeys } from "../setup/hook-trust.js";
import { installHooks } from "../setup/hooks-file.js";

const COMMAND = 'node "/opt/goat/hooks/goat-hook.mjs"';

test("keys are computed the way Codex computes them: path, event label, group, handler", () => {
  const file = installHooks(null, COMMAND);
  const keys = goatHookKeys(file, "/home/u/.codex/hooks.json").map((entry) => entry.key);
  assert.deepEqual(keys, [
    "/home/u/.codex/hooks.json:session_start:0:0",
    "/home/u/.codex/hooks.json:user_prompt_submit:0:0",
    "/home/u/.codex/hooks.json:stop:0:0",
  ]);
});

test("a foreign group ahead of goat's shifts goat's group index, as it does in Codex", () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "other-tool" }] }] } };
  const file = installHooks(existing, COMMAND);
  const stop = goatHookKeys(file, "/h/hooks.json").find((entry) => entry.event === "Stop");
  assert.equal(stop?.key, "/h/hooks.json:stop:1:0");
});

test("only sections carrying a trusted_hash count as trusted", () => {
  const toml = [
    "[hooks.state]",
    "",
    '[hooks.state."/home/u/.codex/hooks.json:session_start:0:0"]',
    'trusted_hash = "sha256:abc"',
    "",
    '[hooks.state."/home/u/.codex/hooks.json:stop:0:0"]',
    "enabled = false",
    "",
    '[hooks.state."superpowers@superpowers:hooks/hooks.json:stop:0:0"]',
    'trusted_hash = "sha256:def"',
    "",
    "[other]",
    'trusted_hash = "not a hook section"',
  ].join("\n");
  const trusted = trustedHookKeys(toml);
  assert.ok(trusted.has("/home/u/.codex/hooks.json:session_start:0:0"));
  assert.ok(!trusted.has("/home/u/.codex/hooks.json:stop:0:0"), "a section without a hash is not trusted");
  assert.ok(trusted.has("superpowers@superpowers:hooks/hooks.json:stop:0:0"));
  assert.equal(trusted.size, 2);
});

// Codex writes the hooks.json path with the platform's separators, and TOML escapes each
// backslash. The report must match what Node builds with path.join on Windows.
test("Windows paths match through TOML escaping and separator differences", () => {
  const file = installHooks(null, COMMAND);
  const toml = [
    '[hooks.state."C:\\\\Users\\\\Admin\\\\.codex\\\\hooks.json:session_start:0:0"]',
    'trusted_hash = "sha256:abc"',
  ].join("\n");
  const report = hookTrustReport(file, "C:\\Users\\Admin\\.codex\\hooks.json", toml);
  const byEvent = Object.fromEntries(report.map((entry) => [entry.event, entry.trusted]));
  assert.equal(byEvent.SessionStart, true);
  assert.equal(byEvent.UserPromptSubmit, false);
  assert.equal(byEvent.Stop, false);
});

test("an empty config trusts nothing, and the report still lists every goat handler", () => {
  const report = hookTrustReport(installHooks(null, COMMAND), "/h/hooks.json", "");
  assert.equal(report.length, 3);
  assert.ok(report.every((entry) => !entry.trusted));
});
