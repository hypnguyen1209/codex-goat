import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  installAgentRoles,
  installedGoatRoles,
  renderRoleToml,
  ROLE_FILE_MARKER,
  roleCards,
  uninstallAgentRoles,
} from "../setup/agent-roles.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-roles-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

test("every bundled card becomes a role with a name, a one-sentence description, and its full text", () => {
  const cards = roleCards();
  assert.equal(cards.length, 9);
  const reviewer = cards.find((card) => card.name === "reviewer");
  assert.equal(reviewer?.description, "You judge a diff.");
  assert.match(reviewer?.developerInstructions ?? "", /^# Reviewer/);
  for (const card of cards) {
    assert.ok(card.description.length > 0 && card.description.length < 160, `${card.name}: bad description`);
    assert.ok(!card.description.startsWith("#"), `${card.name}: description is a heading`);
  }
});

// Codex parses these with deny_unknown_fields; a key it does not know rejects the file.
// name / description / nickname_candidates are the role fields, developer_instructions is
// a config key carried by the flattened ConfigToml (codex-rs/agent-roles/src/agent_role_config.rs).
test("the rendered TOML carries only keys Codex's role loader accepts", () => {
  const toml = renderRoleToml({ name: "verifier", description: 'Decides what is "proven".', developerInstructions: "# Verifier\n\nUse `goat status`.\n" });
  const keys = toml
    .split("\n")
    .filter((line) => /^[a-z_]+\s*=/.test(line))
    .map((line) => line.split("=")[0]?.trim());
  assert.deepEqual(keys, ["name", "description", "developer_instructions"]);
  assert.ok(toml.startsWith(ROLE_FILE_MARKER), "ownership marker must lead the file");
  assert.match(toml, /^description = "Decides what is \\"proven\\"\."$/m, "quotes in a basic string are escaped");
  assert.match(toml, /developer_instructions = '''\n# Verifier\n\nUse `goat status`\.\n'''/, "the card is a literal multi-line string");
});

test("a card containing ''' falls back to an escaped basic string", () => {
  const toml = renderRoleToml({ name: "x", description: "d", developerInstructions: "a '''b''' c" });
  assert.match(toml, /^developer_instructions = "a '''b''' c"$/m);
});

test("install writes one file per card, refuses foreign files, and uninstall removes only goat's", () => {
  const dir = join(sandbox, "agents");
  writeFileSync(join(sandbox, "placeholder"), "");
  // A user's own reviewer.toml must never be overwritten.
  const foreign = join(dir, "reviewer.toml");
  installAgentRoles(dir, [{ name: "planner", description: "p", developerInstructions: "P" }]);
  writeFileSync(foreign, 'name = "reviewer"\ndeveloper_instructions = "mine"\n');

  const report = installAgentRoles(dir);
  assert.ok(report.skipped.includes(foreign), "foreign file was not protected");
  assert.equal(readFileSync(foreign, "utf8"), 'name = "reviewer"\ndeveloper_instructions = "mine"\n');
  assert.equal(report.written.length, 8, "eight goat roles written around the foreign one");
  assert.deepEqual(installedGoatRoles(dir).includes("reviewer"), false);
  assert.ok(installedGoatRoles(dir).includes("planner"));

  const removed = uninstallAgentRoles(dir);
  assert.equal(removed.length, 8);
  assert.ok(existsSync(foreign), "uninstall removed a file goat did not generate");
  assert.deepEqual(installedGoatRoles(dir), []);
});

test("reinstalling over goat's own files is idempotent", () => {
  const dir = join(sandbox, "agents-2");
  const first = installAgentRoles(dir);
  const second = installAgentRoles(dir);
  assert.equal(first.written.length, 9);
  assert.equal(second.written.length, 9);
  assert.equal(second.skipped.length, 0);
});
