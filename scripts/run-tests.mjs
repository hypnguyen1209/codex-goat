#!/usr/bin/env node
/**
 * Run the compiled unit tests on any supported Node.
 *
 * `node --test "dist/__tests__/*.test.js"` only works on Node 22+, where the test runner
 * expands glob patterns itself. package.json declares `engines: node >= 20`, and on 20 the
 * runner takes paths — so that command failed in CI while passing locally on Node 24.
 * Resolving the file list here removes the version dependency entirely.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = join(root, "dist", "__tests__");

if (!existsSync(testDir)) {
  console.error(`No compiled tests at ${testDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const tests = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(testDir, name));

if (tests.length === 0) {
  console.error(`No *.test.js files in ${testDir}; a build that produces no tests is a failure, not a pass.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
