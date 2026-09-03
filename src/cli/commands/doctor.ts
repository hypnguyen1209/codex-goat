import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../../core/fsx.js";
import { color, log } from "../../core/log.js";
import {
  bundledDir,
  codexHome,
  findProjectRoot,
  goatPaths,
  nativeRuntimeBinary,
  packageRoot,
  projectSkillsRoot,
  userSkillsRoot,
} from "../../core/paths.js";
import { runCapture, which } from "../../core/proc.js";
import { hasAgentsSection } from "../../setup/agents-md.js";
import { GOAT_HOOK_MARKER, type HooksFile } from "../../setup/hooks-file.js";
import { STAGE_IDS } from "../../state/stages.js";

/**
 * `goat doctor` checks install shape only. It deliberately does NOT prove that Codex can
 * authenticate — that is what `goat exec` is for, and conflating the two produces
 * false-green readiness reports.
 */

type Level = "pass" | "warn" | "fail";

interface Check {
  name: string;
  level: Level;
  detail: string;
}

export function runDoctor(cwd: string = process.cwd()): number {
  const checks: Check[] = [
    checkNode(),
    checkCodex(),
    checkGit(),
    checkBundle(),
    ...checkSkillsInstalled(cwd),
    checkAgents(cwd),
    checkHooks(cwd),
    checkStateRoot(cwd),
    checkNative(),
  ];

  for (const check of checks) {
    const badge =
      check.level === "pass" ? color.green("PASS") : check.level === "warn" ? color.yellow("WARN") : color.red("FAIL");
    log.out(`${badge}  ${check.name}`);
    log.detail(check.detail);
  }

  const failed = checks.filter((check) => check.level === "fail").length;
  const warned = checks.filter((check) => check.level === "warn").length;

  log.out("");
  if (failed > 0) {
    log.error(`${failed} check(s) failed, ${warned} warning(s).`);
    log.detail("Run `goat setup --scope project` (or `--scope user`) to repair the install.");
    return 1;
  }
  log.ok(`all checks passed${warned > 0 ? `, ${warned} warning(s)` : ""}`);
  log.detail("doctor proves install shape only — run `goat exec \"Reply with exactly GOAT-OK\"` to prove auth");
  return 0;
}

function checkNode(): Check {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 20
    ? { name: "node >= 20", level: "pass", detail: `node ${process.versions.node}` }
    : { name: "node >= 20", level: "fail", detail: `node ${process.versions.node} is too old` };
}

function checkCodex(): Check {
  const path = process.env.GOAT_CODEX_BIN?.trim() ?? which("codex");
  if (!path) {
    return { name: "codex on PATH", level: "fail", detail: "`codex` not found; install OpenAI Codex CLI" };
  }
  const version = runCapture(path, ["--version"], { timeoutMs: 15_000 });
  const label = version.code === 0 ? version.stdout.trim() : "version probe failed";
  return { name: "codex on PATH", level: version.code === 0 ? "pass" : "warn", detail: `${path} (${label})` };
}

function checkGit(): Check {
  const path = which("git");
  return path
    ? { name: "git available", level: "pass", detail: path }
    : { name: "git available", level: "warn", detail: "git missing; --worktree and change detection are unavailable" };
}

function checkBundle(): Check {
  const missing = (["skills", "prompts", "templates", "hooks"] as const).filter(
    (dir) => !existsSync(bundledDir(dir)),
  );
  return missing.length === 0
    ? { name: "bundled assets", level: "pass", detail: `skills, prompts, templates, hooks present in ${packageRoot()}` }
    : { name: "bundled assets", level: "fail", detail: `missing: ${missing.join(", ")}` };
}

function checkSkillsInstalled(cwd: string): Check[] {
  const roots = [
    { label: "project", dir: projectSkillsRoot(findProjectRoot(cwd)) },
    { label: "user", dir: userSkillsRoot() },
  ];
  const installed = new Set<string>();
  const found: string[] = [];

  for (const root of roots) {
    if (!existsSync(root.dir)) continue;
    for (const name of readdirSync(root.dir)) {
      if (existsSync(join(root.dir, name, "SKILL.md"))) {
        installed.add(name);
        found.push(`${root.label}:${name}`);
      }
    }
  }

  const canonical = [...STAGE_IDS];
  const missing = canonical.filter((id) => !installed.has(id));

  const checks: Check[] = [
    missing.length === 0
      ? { name: "canonical skills installed", level: "pass", detail: canonical.join(", ") }
      : {
          name: "canonical skills installed",
          level: "fail",
          detail: `missing: ${missing.join(", ")} — run \`goat setup\``,
        },
  ];
  if (found.length > 0) {
    checks.push({ name: "skill roots", level: "pass", detail: found.join(", ") });
  }
  return checks;
}

function checkAgents(cwd: string): Check {
  const candidates = [join(findProjectRoot(cwd), "AGENTS.md"), join(codexHome(), "AGENTS.md")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    if (hasAgentsSection(readFileSync(file, "utf8"))) {
      return { name: "AGENTS guidance", level: "pass", detail: `goat section present in ${file}` };
    }
  }
  return {
    name: "AGENTS guidance",
    level: "warn",
    detail: "no GOAT:AGENTS block found; run `goat setup` so operating rules are always loaded",
  };
}

function checkHooks(cwd: string): Check {
  const candidates = [join(findProjectRoot(cwd), ".codex", "hooks.json"), join(codexHome(), "hooks.json")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = readJson<HooksFile | null>(file, null);
    const registered = Object.values(parsed?.hooks ?? {}).some((groups) =>
      groups.some((group) => group.hooks?.some((hook) => hook.command?.includes(GOAT_HOOK_MARKER))),
    );
    if (registered) {
      // Registration is not activation. Codex drops a hook whose handler is Untrusted
      // (codex-rs/hooks/src/engine/discovery.rs), and `codex exec` has no trust prompt at
      // all — so a green "registered" line was the most misleading output goat produced.
      return {
        name: "lifecycle hooks",
        level: "warn",
        detail: `registered in ${file} — Codex must still TRUST them before they run (approve the prompt on next launch, or /hooks)`,
      };
    }
  }
  return {
    name: "lifecycle hooks",
    level: "warn",
    detail: "goat hooks not registered; session context and memory injection are off",
  };
}

// There is deliberately no "is the hook handler built" check here.
//
// It looks useful and is not: `dist/cli/goat.js` statically imports `commands/hook.js`,
// which imports `hooks/handler.js`, so `goat doctor` cannot start at all when that file is
// missing — the check could never fire. And in the case it was meant to catch, a plugin
// installed without built code, it would inspect the npm install's `packageRoot()` rather
// than the plugin cache copy that is actually broken, and report PASS.
//
// The real coverage is elsewhere: `scripts/verify-bundle.mjs` refuses to ship a manifest
// whose install channel omits the handler, and `hooks/goat-hook.mjs` names the missing
// module on stderr instead of silently emitting `{}`.

function checkStateRoot(cwd: string): Check {
  const paths = goatPaths(cwd);
  return existsSync(paths.root)
    ? { name: "state root", level: "pass", detail: paths.root }
    : { name: "state root", level: "warn", detail: `${paths.root} not created yet (created on first use)` };
}

function checkNative(): Check {
  const binary = nativeRuntimeBinary();
  return binary
    ? { name: "native runtime", level: "pass", detail: `${binary} (fast hook path)` }
    : {
        name: "native runtime",
        level: "warn",
        detail: "goat-runtime not built; hooks fall back to Node (`npm run build:native` to speed them up)",
      };
}
