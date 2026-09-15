import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readJson, readJsonFile, stripBom } from "../core/fsx.js";
import { goatHookGroup, installHooks, uninstallHooks } from "../setup/hooks-file.js";

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

test("a foreign hook survives a full install then uninstall round trip", () => {
  const foreign = { hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "node /other/tool.js" }] }] } };
  const after = uninstallHooks(installHooks(foreign, COMMAND));
  const stop = after?.hooks?.Stop ?? [];
  assert.equal(stop.length, 1);
  assert.equal(stop[0]?.hooks[0]?.command, "node /other/tool.js");
  assert.ok(existsSync(sandbox));
});
