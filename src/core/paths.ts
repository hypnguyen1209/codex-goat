import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolution rules, in one place, because every other module depends on them:
 *
 *  - `packageRoot()` — where this npm package is installed (ships skills/, prompts/, hooks/).
 *  - `codexHome()`   — Codex's own home, `$CODEX_HOME` or `~/.codex`.
 *  - `projectRoot()` — nearest ancestor of cwd containing a project marker.
 *  - `goatRoot()`    — durable codex-goat state, `$GOAT_ROOT` or `<projectRoot>/.goat`.
 *
 * Nothing here touches the filesystem beyond `existsSync` probes so it stays safe to
 * call from a hook on the hot path.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Markers that identify a project root, highest precedence first. */
export const PROJECT_ROOT_MARKERS = [
  ".git",
  ".goat",
  ".codex",
  ".agents",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
] as const;

/**
 * Where the bundled `skills/`, `prompts/`, `templates/`, and `hooks/` live.
 *
 * `GOAT_HOME` exists for the `bun build --compile` binary, which has no module file on
 * disk to walk up from. A normal npm install never needs it.
 */
export function packageRoot(): string {
  const fromEnv = process.env.GOAT_HOME?.trim();
  if (fromEnv) return resolve(fromEnv);
  // dist/core/paths.js -> dist/core -> dist -> <package root>
  return resolve(HERE, "..", "..");
}

export function codexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), ".codex");
}

/** `~/.agents/skills` is the current user-scope skill root Codex reads. */
export function userSkillsRoot(): string {
  return join(homedir(), ".agents", "skills");
}

export function projectSkillsRoot(root: string): string {
  return join(root, ".agents", "skills");
}

export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}

export function goatRoot(startDir: string = process.cwd()): string {
  const fromEnv = process.env.GOAT_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(findProjectRoot(startDir), ".goat");
}

/** Layout of everything codex-goat writes. Never write outside these paths. */
export function goatPaths(startDir: string = process.cwd()) {
  const root = goatRoot(startDir);
  return {
    root,
    state: join(root, "state"),
    stateFile: join(root, "state", "state.json"),
    ledger: join(root, "ledger.jsonl"),
    plans: join(root, "plans"),
    goals: join(root, "goals"),
    reviews: join(root, "reviews"),
    qa: join(root, "qa"),
    memory: join(root, "memory"),
    memoryFile: join(root, "memory", "observations.jsonl"),
    logs: join(root, "logs"),
    config: join(root, "config.json"),
  };
}

export function bundledDir(name: "skills" | "prompts" | "templates" | "hooks"): string {
  return join(packageRoot(), name);
}

/** Path to the optional native runtime helper, or null when it was never built. */
export function nativeRuntimeBinary(): string | null {
  const exe = process.platform === "win32" ? "goat-runtime.exe" : "goat-runtime";
  const candidates = [
    process.env.GOAT_RUNTIME_BIN?.trim(),
    join(packageRoot(), "bin", exe),
    join(packageRoot(), "target", "release", exe),
    join(packageRoot(), "target", "debug", exe),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}
