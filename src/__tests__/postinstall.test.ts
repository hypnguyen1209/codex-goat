import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { formatPostinstallReport, postinstallPlan } from "../setup/postinstall.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-postinstall-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

/** A package root laid out like a global npm install: no project package.json two levels up. */
function globalRoot(name: string): string {
  const root = join(sandbox, name, "lib", "node_modules", "codex-goat");
  mkdirSync(root, { recursive: true });
  return root;
}

const GLOBAL = { npm_config_global: "true", HOME: "/home/u" };

test("a global install on a user's machine does both: native runtime and user setup", () => {
  const plan = postinstallPlan(GLOBAL, globalRoot("g"));
  assert.deepEqual(plan, { native: true, setup: true, reasons: [] });
});

test("a development checkout does nothing", () => {
  const root = globalRoot("dev");
  mkdirSync(join(root, "src", "cli"), { recursive: true });
  writeFileSync(join(root, "src", "cli", "goat.ts"), "");
  const plan = postinstallPlan(GLOBAL, root);
  assert.equal(plan.native, false);
  assert.equal(plan.setup, false);
  assert.match(plan.reasons[0] ?? "", /development checkout/);
});

test("a project dependency gets the runtime but never touches the user's config", () => {
  const root = join(sandbox, "proj", "node_modules", "codex-goat");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(sandbox, "proj", "package.json"), "{}");
  const plan = postinstallPlan({ HOME: "/home/u" }, root);
  assert.equal(plan.native, true);
  assert.equal(plan.setup, false);
  assert.match(plan.reasons[0] ?? "", /project dependency/);
});

// `sudo npm install -g` runs with root's HOME, so setup would land in /root and the real
// user would see nothing. The runtime still installs: it lives in the package directory.
test("sudo installs the runtime but defers setup to the real user", () => {
  const plan = postinstallPlan({ ...GLOBAL, SUDO_USER: "admin" }, globalRoot("sudo"));
  assert.equal(plan.native, true);
  assert.equal(plan.setup, false);
  assert.match(plan.reasons[0] ?? "", /sudo.*admin/);
});

test("CI never gets a user-scope setup", () => {
  const plan = postinstallPlan({ ...GLOBAL, CI: "true" }, globalRoot("ci"));
  assert.equal(plan.setup, false);
  assert.match(plan.reasons[0] ?? "", /CI/);
  assert.equal(postinstallPlan({ ...GLOBAL, CI: "false" }, globalRoot("ci2")).setup, true);
});

test("each opt-out works on its own", () => {
  assert.deepEqual(postinstallPlan({ ...GLOBAL, GOAT_SKIP_POSTINSTALL: "1" }, globalRoot("all")), {
    native: false,
    setup: false,
    reasons: ["GOAT_SKIP_POSTINSTALL=1"],
  });
  const noNative = postinstallPlan({ ...GLOBAL, GOAT_SKIP_NATIVE: "1" }, globalRoot("nn"));
  assert.equal(noNative.native, false);
  assert.equal(noNative.setup, true);
  const noSetup = postinstallPlan({ ...GLOBAL, GOAT_SKIP_SETUP: "1" }, globalRoot("ns"));
  assert.equal(noSetup.native, true);
  assert.equal(noSetup.setup, false);
});

test("the report tells the user what happened and what to do next", () => {
  const lines = formatPostinstallReport({
    version: "0.1.6",
    plan: { native: true, setup: false, reasons: ["setup skipped: CI environment"] },
    native: { status: "installed", detail: "goat-runtime-0.1.6-linux-x64 verified and installed" },
  });
  assert.equal(lines[0], "codex-goat 0.1.6 installed");
  assert.ok(lines.some((line) => /native runtime: installed/.test(line)));
  assert.ok(lines.some((line) => /note: setup skipped: CI environment/.test(line)));
  assert.ok(lines.some((line) => /goat setup --scope user/.test(line)), "must say how to finish when setup was skipped");
});

// `npm install` in the repo itself runs postinstall too; a developer must see nothing.
test("a development checkout produces no output at all", () => {
  const lines = formatPostinstallReport({
    version: "0.0.0",
    plan: { native: false, setup: false, reasons: ["development checkout; build the runtime with cargo and run goat setup yourself"] },
  });
  assert.deepEqual(lines, []);
});
