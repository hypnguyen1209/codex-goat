import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readJson, readJsonFile, stripBom } from "../core/fsx.js";
import { changedGoatHooks, goatHookGroup, installHooks, SESSION_START_MATCHER, uninstallHooks } from "../setup/hooks-file.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-hooks-safety-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const COMMAND = 'node "/opt/goat/hooks/goat-hook.mjs"';

function write(name: string, contents: string): string {
  const file = join(sandbox, name);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
  return file;
}

// Codex's default for an omitted hook timeout is 600 seconds
// (timeout_sec.unwrap_or(600), codex-rs/hooks/src/engine/discovery.rs). A goat hook that
// hung would have held the user's turn for ten minutes.
test("every registered hook declares a timeout", () => {
  const installed = installHooks(null, COMMAND);
  for (const [event, groups] of Object.entries(installed.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        assert.equal(typeof hook.timeout, "number", `${event} has no timeout; Codex would default it to 600s`);
        assert.ok((hook.timeout ?? 0) > 0 && (hook.timeout ?? 0) <= 60, `${event} timeout ${hook.timeout} is not a sane bound`);
      }
    }
  }
});

test("the shipped hook group matches what setup writes", () => {
  const group = goatHookGroup(COMMAND, "SessionStart");
  assert.equal(group.hooks[0]?.timeout, 10);
  assert.equal(group.hooks[0]?.async, undefined, "SessionStart must stay synchronous; its context is needed this turn");
  assert.equal(goatHookGroup(COMMAND, "Stop").hooks[0]?.async, true);
});

// Read-modify-write on a file another tool also owns.
test("an unparseable hooks file is reported, never silently replaced", () => {
  const file = write("bad/hooks.json", '{ "hooks": { "Stop": [] }, }');
  const read = readJsonFile(file);
  assert.equal(read.kind, "invalid");
  assert.match(read.kind === "invalid" ? read.reason : "", /JSON/i);
});

test("missing and unparseable are different answers", () => {
  assert.equal(readJsonFile(join(sandbox, "nope.json")).kind, "missing");
  assert.equal(readJsonFile(write("ok/hooks.json", '{"hooks":{}}')).kind, "ok");
});

// Regression: `uninstallHooks(null)` returns null, meaning "nothing but goat hooks, delete
// the file". Feeding it an unparseable file's fallback deleted another tool's hooks and
// reported "contained only goat hooks".
test("uninstallHooks(null) means delete, which is why callers must not pass a parse failure", () => {
  assert.equal(uninstallHooks(null), null);
  const foreign = { hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "node /other/tool.js" }] }] } };
  assert.notEqual(uninstallHooks(foreign), null, "a foreign hook must survive uninstall");
});

test("a byte-order mark does not make a valid file look corrupt", () => {
  assert.equal(stripBom("﻿{}"), "{}");
  assert.equal(stripBom("{}"), "{}");
  const file = write("bom/hooks.json", '﻿{"hooks":{"Stop":[]}}');
  const read = readJsonFile<{ hooks: unknown }>(file);
  assert.equal(read.kind, "ok", "a BOM-prefixed file must parse");
  assert.deepEqual(readJson(file, null), { hooks: { Stop: [] } });
});

// Codex hashes the handler definition (command, matcher, timeout, async, statusMessage)
// and stores that hash on approval. Changing any field makes the stored hash stale, Codex
// marks the handler `Modified`, and only Trusted/Managed handlers run — so an upgrade that
// edits a hook silently disables goat on every machine that had approved it. Adding
// `timeout: 10` in 0.1.8 was exactly such a change.
test("a changed hook definition is reported so the user can re-approve", () => {
  const stale: Parameters<typeof changedGoatHooks>[0] = {
    hooks: {
      SessionStart: [{ matcher: SESSION_START_MATCHER, hooks: [{ type: "command", command: COMMAND, timeout: 5 }] }],
      Stop: [{ hooks: [{ type: "command", command: COMMAND, timeout: 15, async: true }] }],
    },
  };
  const next = installHooks(stale, COMMAND);
  const changed = changedGoatHooks(stale, next);
  assert.ok(changed.includes("SessionStart"), "a changed timeout/statusMessage must be reported");
  assert.ok(!changed.includes("UserPromptSubmit"), "a hook that was not previously present is not a re-approval");
});

test("reinstalling an unchanged file reports nothing to re-approve", () => {
  const installed = installHooks(null, COMMAND);
  assert.deepEqual(changedGoatHooks(installed, installHooks(installed, COMMAND)), []);
});

test("a foreign hook that goat never owned is not reported as changed", () => {
  const foreign = { hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "node /other/tool.js" }] }] } };
  assert.deepEqual(changedGoatHooks(foreign, installHooks(foreign, COMMAND)), []);
});

test("a foreign hook survives a full install then uninstall round trip", () => {
  const foreign = { hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "node /other/tool.js" }] }] } };
  const after = uninstallHooks(installHooks(foreign, COMMAND));
  const stop = after?.hooks?.Stop ?? [];
  assert.equal(stop.length, 1);
  assert.equal(stop[0]?.hooks[0]?.command, "node /other/tool.js");
  assert.ok(existsSync(sandbox));
});
