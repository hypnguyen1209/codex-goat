import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureDir, readJsonFile, writeFileAtomic, writeJsonAtomic } from "../../core/fsx.js";
import { GoatError, log } from "../../core/log.js";
import {
  bundledDir,
  codexHome,
  findProjectRoot,
  goatPaths,
  packageRoot,
  projectSkillsRoot,
  userSkillsRoot,
} from "../../core/paths.js";
import { hasAgentsSection, mergeAgentsSection } from "../../setup/agents-md.js";
import {
  changedGoatHooks,
  type GoatHookEvent,
  type HooksFile,
  installHooks,
  unsupportedTopLevelKeys,
} from "../../setup/hooks-file.js";
import type { ParsedArgs } from "../args.js";
import { flagBool, flagString } from "../args.js";

export type Scope = "user" | "project";

export interface SetupTargets {
  scope: Scope;
  skillsRoot: string;
  agentsFile: string;
  hooksFile: string;
  goatRoot: string;
}

export function resolveTargets(scope: Scope, cwd: string = process.cwd()): SetupTargets {
  if (scope === "user") {
    return {
      scope,
      skillsRoot: userSkillsRoot(),
      agentsFile: join(codexHome(), "AGENTS.md"),
      hooksFile: join(codexHome(), "hooks.json"),
      goatRoot: join(homedir(), ".goat"),
    };
  }
  const root = findProjectRoot(cwd);
  return {
    scope,
    skillsRoot: projectSkillsRoot(root),
    agentsFile: join(root, "AGENTS.md"),
    hooksFile: join(root, ".codex", "hooks.json"),
    goatRoot: goatPaths(cwd).root,
  };
}

/**
 * What a setup run produced. `rehashedHooks` is the part callers must not swallow: npm
 * buffers a lifecycle script's stderr, so an `npm i -g` upgrade that changes a hook
 * definition would otherwise invalidate the user's approval with nothing said.
 */
export interface SetupResult {
  targets: SetupTargets;
  rehashedHooks: GoatHookEvent[];
}

export function runSetup(parsed: ParsedArgs, cwd: string = process.cwd()): number {
  const scopeFlag = flagString(parsed.flags, "scope") ?? "project";
  if (scopeFlag !== "user" && scopeFlag !== "project") {
    throw new GoatError(`Unknown --scope '${scopeFlag}'.`, "Use --scope user or --scope project.");
  }
  const force = flagBool(parsed.flags, "force");
  performSetup(scopeFlag, { force, cwd });
  log.detail("next: `goat doctor`, then `goat --madmax --xhigh` from your project");
  return 0;
}

/**
 * The whole install for one scope: skills, role references, the AGENTS block, the hook
 * registrations, and the seeded `.goat/`. Idempotent and marker-based, so npm's
 * postinstall and the first `goat` launch can call it as freely as `goat setup` does.
 */
export function performSetup(scope: Scope, options: { force?: boolean; cwd?: string; quiet?: boolean } = {}): SetupResult {
  const targets = resolveTargets(scope, options.cwd ?? process.cwd());
  if (!options.quiet) log.info(`installing codex-goat (${targets.scope} scope)`);

  installSkills(targets, options.force ?? false);
  installRoleReferences(targets);
  installAgentsGuidance(targets);
  const rehashedHooks = installHookRegistrations(targets);
  seedGoatRoot(targets);

  if (!options.quiet) {
    log.ok("setup complete");
    log.detail(`skills   -> ${targets.skillsRoot}`);
    log.detail(`AGENTS   -> ${targets.agentsFile}`);
    log.detail(`hooks    -> ${targets.hooksFile}`);
    log.detail(`state    -> ${targets.goatRoot}`);
  }
  return { targets, rehashedHooks };
}

/**
 * Has the user-scope install happened on this machine? Checked by the first `goat`
 * launch so that an install where postinstall could not run still ends up complete.
 * Both halves must be present: skills without the AGENTS block is the half-install
 * that a `--ignore-scripts` upgrade or a hand-copied skills directory leaves behind.
 */
export function isUserScopeInstalled(): boolean {
  const targets = resolveTargets("user");
  if (!existsSync(join(targets.skillsRoot, "plan", "SKILL.md"))) return false;
  if (!existsSync(targets.agentsFile)) return false;
  return hasAgentsSection(readFileSync(targets.agentsFile, "utf8"));
}

/** Copy every bundled skill. Existing non-goat skills with the same name are left alone. */
function installSkills(targets: SetupTargets, force: boolean): void {
  const source = bundledDir("skills");
  if (!existsSync(source)) throw new GoatError(`Bundled skills missing at ${source}.`, "Reinstall codex-goat.");

  ensureDir(targets.skillsRoot);
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    if (!statSync(from).isDirectory()) continue;
    const to = join(targets.skillsRoot, name);

    if (existsSync(to) && !isGoatOwned(to) && !force) {
      log.warn(`skill '${name}' already exists and is not goat-owned; skipped (use --force to overwrite)`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
  log.ok(`skills installed into ${targets.skillsRoot}`);
}

/** `prompts/` is the single source of truth; the goat-roles skill gets a copy as references. */
function installRoleReferences(targets: SetupTargets): void {
  const source = bundledDir("prompts");
  if (!existsSync(source)) return;
  const dest = join(targets.skillsRoot, "goat-roles", "references");
  ensureDir(dest);
  for (const name of readdirSync(source)) {
    if (!name.endsWith(".md")) continue;
    cpSync(join(source, name), join(dest, name));
  }
  log.ok(`role prompts installed into ${dest}`);
}

function installAgentsGuidance(targets: SetupTargets): void {
  const template = join(bundledDir("templates"), "AGENTS.md");
  if (!existsSync(template)) throw new GoatError(`Missing AGENTS template at ${template}.`, "Reinstall codex-goat.");

  const generated = readFileSync(template, "utf8");
  const existing = existsSync(targets.agentsFile) ? readFileSync(targets.agentsFile, "utf8") : null;
  writeFileAtomic(targets.agentsFile, mergeAgentsSection(existing, generated));
  log.ok(`AGENTS guidance merged into ${targets.agentsFile}`);
}

function installHookRegistrations(targets: SetupTargets): GoatHookEvent[] {
  const script = join(packageRoot(), "hooks", "goat-hook.mjs");
  if (!existsSync(script)) {
    log.warn(`hook script missing at ${script}; skipping hook registration`);
    return [];
  }
  const command = `node "${script}"`;
  const read = readJsonFile<HooksFile>(targets.hooksFile);
  if (read.kind === "invalid") {
    // Rewriting it would drop whatever another tool registered there. Until 0.1.8 an
    // unparseable file read as `null` and setup wrote a fresh one holding only goat's hooks.
    log.warn(`did not register hooks: ${targets.hooksFile} is not valid JSON (${read.reason})`);
    log.detail("fix or remove that file, then re-run `goat setup`; goat will not overwrite a hooks file it cannot read");
    return [];
  }
  const existing = read.kind === "ok" ? read.value : null;

  // Codex rejects the whole file if it carries an unknown top-level key, so those cannot
  // be forwarded. Say exactly what was dropped rather than silently rewriting the file.
  for (const key of unsupportedTopLevelKeys(existing)) {
    log.warn(`removed unsupported top-level key '${key}' from ${targets.hooksFile}`);
    log.detail("Codex parses hooks.json with deny_unknown_fields; keeping it would disable every hook in the file");
  }

  const next = installHooks(existing, command);
  // Codex's trust hash covers the handler definition, so editing one invalidates an
  // approval the user already gave and Codex then skips the hook without a word.
  const rehashed = changedGoatHooks(existing, next);

  mkdirSync(join(targets.hooksFile, ".."), { recursive: true });
  writeJsonAtomic(targets.hooksFile, next);
  log.ok(`hooks registered in ${targets.hooksFile}`);
  if (rehashed.length > 0) {
    log.warn(`hook definitions changed (${rehashed.join(", ")}); any approval you gave them is now stale`);
    log.detail("re-approve in the Codex TUI (/hooks) or Codex will skip them — it hashes the handler, timeout included");
  } else {
    log.detail("Codex asks once to trust new hooks; approve it to enable session context injection");
  }
  return rehashed;
}

function seedGoatRoot(targets: SetupTargets): void {
  for (const dir of ["state", "plans", "goals", "reviews", "qa", "memory", "logs"]) {
    ensureDir(join(targets.goatRoot, dir));
  }
  const configFile = join(targets.goatRoot, "config.json");
  if (!existsSync(configFile)) {
    writeJsonAtomic(configFile, { version: 1, scope: targets.scope, memory: { enabled: true, digestSize: 8 } });
  }
}

/** A directory is goat-owned when its SKILL.md declares the marker. */
function isGoatOwned(dir: string): boolean {
  try {
    return readFileSync(join(dir, "SKILL.md"), "utf8").includes("codex-goat");
  } catch {
    return false;
  }
}
