import { ensureDir } from "../core/fsx.js";
import { GoatError, log } from "../core/log.js";
import { goatPaths } from "../core/paths.js";
import { runCapture, runInherit, which } from "../core/proc.js";
import { compareVersions, parseCodexVersion, resolveRouteModel, routeFor } from "../state/routing.js";
import { normalizeStageId, STAGE_IDS } from "../state/stages.js";
import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";
import { isUserScopeInstalled, performSetup } from "./commands/setup.js";
import { ensureNativeRuntimeOnce } from "../setup/postinstall.js";

/**
 * `goat` with no subcommand launches Codex with stronger defaults.
 *
 * Everything injected here is visible: `goat --print-argv` shows the exact `codex`
 * command line. A wrapper that quietly changes behavior is worse than no wrapper.
 */

/**
 * Codex's `model_reasoning_effort` vocabulary (codex-rs/protocol/src/openai_models.rs),
 * minus `none`, `persistent` and free-form custom values, which are not sensible defaults
 * to type by hand. Not every model accepts every level — luna has no `ultra` — and that is
 * Codex's error to raise, not goat's to pre-empt: until 0.1.6 `--effort max` was silently
 * turned into `high`, which is the opposite of what a wrapper should do with an explicit
 * instruction.
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

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
const CONSUMED = new Set(["madmax", "safe", "xhigh", "high", "medium", "low", "no-goat-defaults", "print-argv", "effort", "for"]);

/**
 * goat runs Codex in yolo mode by default: no approval prompts, no sandbox. That is the
 * point of a wrapper whose whole job is to let Codex finish work, and it is what
 * `--madmax` used to opt into. It is injected as the two config overrides Codex's own
 * `--yolo` flag sets, so `--print-argv` shows it and any explicit permission flag or
 * `-c` for the same key the user types wins. `--safe` keeps Codex's own defaults.
 */
const YOLO_APPROVAL = ["-c", 'approval_policy="never"'];
const YOLO_SANDBOX = ["-c", 'sandbox_mode="danger-full-access"'];

/** Which permission keys the user already set explicitly, so goat must not override them. */
export function explicitPermissions(tokens: readonly string[]): { approval: boolean; sandbox: boolean } {
  let approval = false;
  let sandbox = false;
  // Scanned past `--` too: a permission flag the user typed anywhere is theirs to keep.
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "-a" || token === "--ask-for-approval" || token.startsWith("--ask-for-approval=")) approval = true;
    if (token === "-s" || token === "--sandbox" || token.startsWith("--sandbox=")) sandbox = true;
    if (token === "--full-auto" || token === "--yolo" || token === "--dangerously-bypass-approvals-and-sandbox" || token === "--madmax") {
      approval = true;
      sandbox = true;
    }
    // `-c key=value`, `-c=key=value`, `--config key=value`, `--config=key=value`.
    let override: string | null = null;
    if (token === "-c" || token === "--config") override = tokens[index + 1] ?? null;
    else if (token.startsWith("-c=")) override = token.slice(3);
    else if (token.startsWith("--config=")) override = token.slice(9);
    if (override?.startsWith("approval_policy=")) approval = true;
    if (override?.startsWith("sandbox_mode=")) sandbox = true;
  }
  return { approval, sandbox };
}

/** The yolo overrides goat injects, minus any key the user set explicitly. */
export function permissionOverrides(tokens: readonly string[], safe: boolean): { args: string[]; notes: string[] } {
  if (safe) return { args: [], notes: ["safe: Codex's own approval and sandbox defaults"] };
  const explicit = explicitPermissions(tokens);
  const args: string[] = [];
  const injected: string[] = [];
  if (!explicit.approval) {
    args.push(...YOLO_APPROVAL);
    injected.push("approvals never");
  }
  if (!explicit.sandbox) {
    args.push(...YOLO_SANDBOX);
    injected.push("sandbox danger-full-access");
  }
  const notes =
    injected.length > 0
      ? [`yolo: ${injected.join(", ")} (--safe to opt out)`]
      : ["yolo: keeping your explicit approval and sandbox flags"];
  return { args, notes };
}

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
    const yolo = permissionOverrides(parsed.raw, flagBool(parsed.flags, "safe"));
    args.push(...yolo.args);
    notes.push(...yolo.notes);
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
  if (explicit !== undefined) {
    if (isEffort(explicit)) return explicit;
    throw new GoatError(`Unknown reasoning effort '${explicit}'.`, `Codex accepts: ${REASONING_EFFORTS.join(", ")}`);
  }
  if (flagBool(parsed.flags, "xhigh")) return "xhigh";
  if (flagBool(parsed.flags, "high")) return "high";
  if (flagBool(parsed.flags, "medium")) return "medium";
  if (flagBool(parsed.flags, "low")) return "low";
  if (routed && isEffort(routed)) return routed;
  // The default is deliberately `high`, not `xhigh`: strong without being needlessly slow.
  return "high";
}

function isEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
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

  // One command is the whole install. npm's postinstall normally does this, but it is
  // skipped under --ignore-scripts, sudo, CI, and by package managers that do not run
  // it — so the first real launch finishes the job. Idempotent, marker-based, and undone
  // by `goat uninstall --scope user`.
  if (process.env.GOAT_SKIP_SETUP !== "1" && !isUserScopeInstalled()) {
    log.info("first launch: installing codex-goat for this user (skills, AGENTS guidance, hooks)");
    const { rehashedHooks } = performSetup("user", { force: false, quiet: true });
    if (rehashedHooks.length > 0) {
      log.warn(`hook definitions changed (${rehashedHooks.join(", ")}); re-approve them in the Codex TUI (/hooks) or Codex will skip them`);
    }
    log.detail("done; Codex will ask once to trust the hooks. `goat uninstall --scope user` removes all of it");
  }
  // Same net for the native runtime: npm gates global install scripts behind
  // --allow-scripts, so postinstall may never have run. Tried once per version.
  const native = await ensureNativeRuntimeOnce();
  if (native?.status === "installed") log.detail(`native hook runtime installed (${native.detail})`);
  else if (native?.status === "failed") log.detail(`native hook runtime not installed: ${native.detail}`);

  ensureDir(goatPaths(cwd).root);
  for (const note of plan.notes) log.detail(note);
  return runInherit(plan.binary, plan.args, { cwd });
}

/** Quote for display only, so `--print-argv` output can be pasted into a shell. */
function shellQuote(token: string): string {
  return /^[\w@%+=:,./-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}
