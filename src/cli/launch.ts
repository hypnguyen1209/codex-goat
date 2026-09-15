import { ensureDir } from "../core/fsx.js";
import { GoatError, log } from "../core/log.js";
import { goatPaths } from "../core/paths.js";
import { runCapture, runInherit, which } from "../core/proc.js";
import { compareVersions, parseCodexVersion, resolveRouteModel, routeFor } from "../state/routing.js";
import { normalizeStageId, STAGE_IDS } from "../state/stages.js";
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

/**
 * Long flags goat consumes rather than forwarding.
 *
 * `--worktree` is deliberately absent. Codex grew its own managed worktrees (`--worktree`,
 * a boolean, checkouts under `~/.codex/worktrees`), so goat's `../<repo>.goat-worktrees`
 * implementation was retired after 0.1.5 and the flag now reaches Codex untouched.
 */
const CONSUMED = new Set(["madmax", "xhigh", "high", "medium", "low", "no-goat-defaults", "print-argv", "effort", "for"]);

/** Goat flags that swallow the following token (`--effort high`). */
const CONSUMED_WITH_VALUE = new Set(["effort", "for"]);

/** First Codex release whose CLI accepts `--worktree`. Older ones reject it as unknown. */
const NATIVE_WORKTREE_MIN_CODEX = "0.155.0";

export function buildLaunchPlan(parsed: ParsedArgs, cwd: string = process.cwd()): LaunchPlan {
  const notes: string[] = [];
  const args: string[] = [];

  // `--for <stage>` picks the model that stage is routed to. A session runs one model,
  // so this is how a plan written by one model gets executed by another: the stages meet
  // through `.goat/`, not inside a single conversation.
  const requested = flagString(parsed.flags, "for");
  const stage = requested ? normalizeStageId(requested) : null;
  if (requested && !stage) {
    throw new GoatError(`Unknown stage '${requested}' for --for.`, `Stages: ${STAGE_IDS.join(", ")}`);
  }
  const route = stage ? routeFor(stage, cwd) : {};

  const effort = resolveEffort(parsed, route.effort);
  const useDefaults = !flagBool(parsed.flags, "no-goat-defaults");

  if (useDefaults) {
    args.push("-c", `model_reasoning_effort="${effort}"`);
    notes.push(`reasoning effort = ${effort}`);
  }

  // An explicit -m/--model always wins; routing only fills a gap the user left.
  const explicitModel = parsed.raw.some((token) => token === "-m" || token === "--model" || token.startsWith("--model="));
  if (stage && route.model && !explicitModel && useDefaults) {
    // Only routes that name a minimum version pay for the version probe.
    const resolved = resolveRouteModel(route, route.minCodex ? codexVersion() : null);
    if (resolved) {
      args.push("-m", resolved.model);
      notes.push(`$${stage} routed to ${resolved.model}`);
      if (resolved.note) notes.push(resolved.note);
    }
  } else if (stage && explicitModel) {
    notes.push(`$${stage}: keeping your explicit --model over the route`);
  }

  if (flagBool(parsed.flags, "madmax")) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
    notes.push("madmax: approvals and sandbox bypassed (trusted repos only)");
  }

  // Forward everything goat does not own, in the order the user typed it. Re-deriving
  // from the parsed flag map would reorder `-m gpt-5` relative to a positional prompt.
  const forwarded = forwardedTokens(parsed.raw);
  args.push(...forwarded);

  if (forwarded.some((token) => token === "--worktree" || token.startsWith("--worktree="))) {
    const installed = codexVersion();
    if (installed === null || compareVersions(installed, NATIVE_WORKTREE_MIN_CODEX) < 0) {
      notes.push(
        `--worktree is Codex's native flag since ${NATIVE_WORKTREE_MIN_CODEX}` +
          `${installed ? ` (installed ${installed})` : ""}; this Codex will reject it. goat's own worktrees were retired after 0.1.5.`,
      );
    }
  }

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

    out.push(token);
  }

  return out;
}

function isValue(token: string | undefined): boolean {
  return token !== undefined && !token.startsWith("-");
}

/**
 * Explicit flags beat the stage route, which beats the default. A user who types
 * `--low` means it, even alongside `--for plan`.
 */
function resolveEffort(parsed: ParsedArgs, routed?: string): ReasoningEffort {
  const explicit = flagString(parsed.flags, "effort");
  if (explicit && isEffort(explicit)) return explicit;
  if (flagBool(parsed.flags, "xhigh")) return "xhigh";
  if (flagBool(parsed.flags, "high")) return "high";
  if (flagBool(parsed.flags, "medium")) return "medium";
  if (flagBool(parsed.flags, "low")) return "low";
  if (routed && isEffort(routed)) return routed;
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

let probedVersion: string | null | undefined;

/**
 * The installed Codex version, e.g. `0.154.0`, or null when it cannot be read.
 *
 * Probed once per process. `GOAT_CODEX_VERSION` overrides the probe, which is how tests
 * pin a version and how a user with an unusual `codex` shim can tell goat what it is.
 */
export function codexVersion(): string | null {
  const pinned = process.env.GOAT_CODEX_VERSION?.trim();
  if (pinned) return parseCodexVersion(pinned);
  if (probedVersion !== undefined) return probedVersion;
  const result = runCapture(codexBinary(), ["--version"], { timeoutMs: 15_000 });
  probedVersion = result.code === 0 ? parseCodexVersion(result.stdout) : null;
  return probedVersion;
}

export async function launch(parsed: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const dryRun = flagBool(parsed.flags, "print-argv");
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
