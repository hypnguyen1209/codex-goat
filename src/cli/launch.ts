import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ensureDir } from "../core/fsx.js";
import { GoatError, log } from "../core/log.js";
import { findProjectRoot, goatPaths } from "../core/paths.js";
import { runCapture, runInherit, which } from "../core/proc.js";
import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";

/**
 * `goat` with no subcommand launches Codex with stronger defaults.
 *
 * Everything injected here is visible: `goat --print-argv` shows the exact `codex`
 * command line. A wrapper that quietly changes behavior is worse than no wrapper.
 */

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface LaunchPlan {
  binary: string;
  args: string[];
  cwd: string;
  /** Human-readable notes about what goat injected and why. */
  notes: string[];
}

/** Long flags goat consumes rather than forwarding. */
const CONSUMED = new Set([
  "madmax",
  "xhigh",
  "high",
  "medium",
  "low",
  "worktree",
  "no-goat-defaults",
  "print-argv",
  "effort",
]);

/** Goat flags that swallow the following token (`--effort high`, `-w feat/x`). */
const CONSUMED_WITH_VALUE = new Set(["effort", "worktree", "w"]);

export function buildLaunchPlan(parsed: ParsedArgs, cwd: string = process.cwd()): LaunchPlan {
  const notes: string[] = [];
  const args: string[] = [];

  const effort = resolveEffort(parsed);
  const useDefaults = !flagBool(parsed.flags, "no-goat-defaults");

  if (useDefaults) {
    args.push("-c", `model_reasoning_effort="${effort}"`);
    notes.push(`reasoning effort = ${effort}`);
  }

  if (flagBool(parsed.flags, "madmax")) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
    notes.push("madmax: approvals and sandbox bypassed (trusted repos only)");
  }

  // Forward everything goat does not own, in the order the user typed it. Re-deriving
  // from the parsed flag map would reorder `-m gpt-5` relative to a positional prompt.
  args.push(...forwardedTokens(parsed.raw));

  return { binary: codexBinary(), args, cwd, notes };
}

/** Strip goat-owned flags from argv, leaving everything else untouched and in order. */
export function forwardedTokens(argv: readonly string[]): string[] {
  const out: string[] = [];
  let afterSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (afterSeparator) {
      out.push(token);
      continue;
    }
    if (token === "--") {
      // The separator itself is goat's; everything after it is Codex's.
      afterSeparator = true;
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const name = body.includes("=") ? body.slice(0, body.indexOf("=")) : body;
      if (CONSUMED.has(name)) {
        if (!body.includes("=") && CONSUMED_WITH_VALUE.has(name) && isValue(argv[index + 1])) index += 1;
        continue;
      }
      out.push(token);
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const name = token.slice(1);
      if (CONSUMED_WITH_VALUE.has(name)) {
        if (isValue(argv[index + 1])) index += 1;
        continue;
      }
    }

    out.push(token);
  }

  return out;
}

function isValue(token: string | undefined): boolean {
  return token !== undefined && !token.startsWith("-");
}

function resolveEffort(parsed: ParsedArgs): ReasoningEffort {
  const explicit = flagString(parsed.flags, "effort");
  if (explicit && isEffort(explicit)) return explicit;
  if (flagBool(parsed.flags, "xhigh")) return "xhigh";
  if (flagBool(parsed.flags, "high")) return "high";
  if (flagBool(parsed.flags, "medium")) return "medium";
  if (flagBool(parsed.flags, "low")) return "low";
  // The default is deliberately `high`, not `xhigh`: strong without being needlessly slow.
  return "high";
}

function isEffort(value: string): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

export function codexBinary(): string {
  const fromEnv = process.env.GOAT_CODEX_BIN?.trim();
  if (fromEnv) return fromEnv;
  const found = which("codex");
  if (!found) {
    throw new GoatError(
      "`codex` was not found on PATH.",
      "Install Codex CLI (`npm install -g @openai/codex` or Homebrew), then re-run `goat doctor`.",
    );
  }
  return "codex";
}

export async function launch(parsed: ParsedArgs): Promise<number> {
  let cwd = process.cwd();
  const dryRun = flagBool(parsed.flags, "print-argv");

  const worktree = parsed.flags.get("worktree") ?? parsed.flags.get("w");
  // `--print-argv` is a dry run, so it must not create a worktree as a side effect.
  if (worktree !== undefined && !dryRun) {
    cwd = ensureWorktree(worktree === true ? null : worktree, cwd);
  }

  const plan = buildLaunchPlan(parsed, cwd);

  if (dryRun) {
    log.out([plan.binary, ...plan.args].map(shellQuote).join(" "));
    return 0;
  }

  ensureDir(goatPaths(cwd).root);
  for (const note of plan.notes) log.detail(note);
  return runInherit(plan.binary, plan.args, { cwd });
}

/** Quote for display only, so `--print-argv` output can be pasted into a shell. */
function shellQuote(token: string): string {
  return /^[\w@%+=:,./-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * Create or reuse `../<repo>.goat-worktrees/<name>`.
 *
 * A named worktree is the safe way to run `--madmax`, and the only sane way to run more
 * than one aggressive session against the same repository at once.
 */
export function ensureWorktree(name: string | null, cwd: string): string {
  const root = findProjectRoot(cwd);
  if (!existsSync(join(root, ".git"))) {
    throw new GoatError("--worktree requires a git repository.", "Run without --worktree, or `git init` first.");
  }

  const branch = name ?? "goat-detached";
  const safe = branch.replace(/[^\w.-]+/g, "-");
  const parent = resolve(root, "..", `${basename(root)}.goat-worktrees`);
  const target = join(parent, safe);

  if (existsSync(target)) {
    log.detail(`reusing worktree ${target}`);
    return target;
  }

  ensureDir(parent);
  const branchExists = runCapture("git", ["rev-parse", "--verify", branch], { cwd: root }).code === 0;
  const args = branchExists
    ? ["worktree", "add", target, branch]
    : ["worktree", "add", "-b", branch, target];

  const result = runCapture("git", args, { cwd: root, timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new GoatError(
      `git worktree add failed: ${result.stderr.trim() || result.stdout.trim()}`,
      "Remove the stale worktree with `git worktree remove`, or pick a different --worktree name.",
    );
  }
  log.ok(`worktree ready at ${target}`);
  return target;
}
