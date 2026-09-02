import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../../core/fsx.js";
import { GoatError, log } from "../../core/log.js";
import { stripAgentsSection } from "../../setup/agents-md.js";
import { type HooksFile, uninstallHooks } from "../../setup/hooks-file.js";
import type { ParsedArgs } from "../args.js";
import { flagString } from "../args.js";
import { resolveTargets, type Scope } from "./setup.js";

/**
 * Remove everything goat installed and nothing else.
 *
 * Durable work under `.goat/` (plans, goals, reviews, ledger) is never deleted here —
 * losing a user's plan history to an uninstall would be unrecoverable. `--purge-state`
 * is the explicit opt-in.
 */
export function runUninstall(parsed: ParsedArgs, cwd: string = process.cwd()): number {
  const scopeFlag = (flagString(parsed.flags, "scope") ?? "project") as Scope;
  if (scopeFlag !== "user" && scopeFlag !== "project") {
    throw new GoatError(`Unknown --scope '${scopeFlag}'.`, "Use --scope user or --scope project.");
  }
  const targets = resolveTargets(scopeFlag, cwd);

  if (existsSync(targets.skillsRoot)) {
    for (const name of readdirSync(targets.skillsRoot)) {
      const skillFile = join(targets.skillsRoot, name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      if (!readFileSync(skillFile, "utf8").includes("codex-goat")) continue;
      rmSync(join(targets.skillsRoot, name), { recursive: true, force: true });
      log.detail(`removed skill ${name}`);
    }
  }

  if (existsSync(targets.agentsFile)) {
    const stripped = stripAgentsSection(readFileSync(targets.agentsFile, "utf8"));
    writeFileAtomic(targets.agentsFile, stripped);
    log.detail(`removed GOAT section from ${targets.agentsFile}`);
  }

  if (existsSync(targets.hooksFile)) {
    const next = uninstallHooks(readJson<HooksFile | null>(targets.hooksFile, null));
    if (next === null) {
      unlinkSync(targets.hooksFile);
      log.detail(`removed ${targets.hooksFile} (contained only goat hooks)`);
    } else {
      writeJsonAtomic(targets.hooksFile, next);
      log.detail(`removed goat hooks from ${targets.hooksFile}, kept other entries`);
    }
  }

  if (parsed.flags.has("purge-state")) {
    rmSync(targets.goatRoot, { recursive: true, force: true });
    log.warn(`purged ${targets.goatRoot}`);
  } else {
    log.detail(`kept ${targets.goatRoot} (pass --purge-state to delete plans, goals, and the ledger)`);
  }

  log.ok("uninstall complete");
  return 0;
}
