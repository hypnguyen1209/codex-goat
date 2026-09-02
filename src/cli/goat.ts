#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoatError, log } from "../core/log.js";
import { packageRoot } from "../core/paths.js";
import { parseArgs } from "./args.js";
import { runDoctor } from "./commands/doctor.js";
import { runExec } from "./commands/exec.js";
import { runHook } from "./commands/hook.js";
import { runSetup } from "./commands/setup.js";
import { runSkills } from "./commands/skills.js";
import { runContract, runLedger, runState } from "./commands/state.js";
import { runStatus } from "./commands/status.js";
import { runUninstall } from "./commands/uninstall.js";
import { printHelp } from "./help.js";
import { launch } from "./launch.js";
import { VERSION } from "../version.js";

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.command === null && (parsed.flags.has("help") || parsed.flags.has("h"))) {
    printHelp();
    return 0;
  }
  if (parsed.command === null && (parsed.flags.has("version") || parsed.flags.has("V"))) {
    log.out(readVersion());
    return 0;
  }

  switch (parsed.command) {
    case "help":
      printHelp();
      return 0;
    case "version":
      log.out(readVersion());
      return 0;
    case "setup":
      return runSetup(parsed);
    case "doctor":
      return runDoctor();
    case "exec":
      return runExec(parsed);
    case "status":
      return runStatus();
    case "state":
      return runState(parsed);
    case "contract":
      return runContract(parsed);
    case "ledger":
      return runLedger(parsed);
    case "skills":
      return runSkills(parsed);
    case "hook":
      return runHook();
    case "uninstall":
      return runUninstall(parsed);
    default:
      // No goat subcommand: this is a Codex launch.
      return launch(parsed);
  }
}

export function readVersion(): string {
  // Prefer package.json so a locally patched install reports its real version; fall back
  // to the compiled-in constant, which is all a single-file binary has.
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? VERSION;
  } catch {
    return VERSION;
  }
}

/**
 * Run only when this file is the process entry point.
 *
 * Two installs have to work, and they fail in different ways:
 *   - npm: `process.argv[1]` is the bin shim, usually a symlink, so a raw string compare
 *     never matches — hence `realpathSync`.
 *   - `bun build --compile`: both sides live in the binary's virtual filesystem, where
 *     `argv[1]` uses forward slashes and `import.meta.url` decodes to backslashes, and
 *     `realpathSync` may refuse the path entirely — hence `resolve` plus a fallback.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  let modulePath: string;
  try {
    modulePath = fileURLToPath(import.meta.url);
  } catch {
    // No file path at all: this build has no module file, so it is the entry point.
    return true;
  }
  return canonicalPath(entry) === canonicalPath(modulePath);
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof GoatError) {
        log.error(error.message);
        if (error.hint) log.detail(error.hint);
      } else {
        log.error(error instanceof Error ? error.message : String(error));
      }
      process.exitCode = 1;
    });
}
