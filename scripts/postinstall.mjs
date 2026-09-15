#!/usr/bin/env node
/**
 * npm `postinstall` for codex-goat: fetch the native runtime for this platform and, on a
 * global install, run the user-scope setup — so `npm install -g codex-goat` is the whole
 * install. See src/setup/postinstall.ts for the decision rules.
 *
 * This file must never fail the install. Every error is caught, and in a development
 * checkout `dist/` may not exist yet, which is fine: nothing needs doing there.
 */
const write = (lines) => {
  for (const line of lines) process.stdout.write(`${line}\n`);
};

try {
  const { runPostinstall, formatPostinstallReport } = await import("../dist/setup/postinstall.js");
  const { performSetup } = await import("../dist/cli/commands/setup.js");
  const report = await runPostinstall(process.env, undefined, () => {
    const targets = performSetup("user", { force: false, quiet: true });
    return `skills, AGENTS guidance and hooks installed for this user (${targets.skillsRoot}); Codex will ask once to trust the hooks`;
  });
  write(formatPostinstallReport(report));
} catch (error) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(message)) {
    process.stdout.write(`codex-goat postinstall skipped: ${message}\n`);
  }
}
process.exit(0);
