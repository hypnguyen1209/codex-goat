import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../core/paths.js";
import { installNativeRuntime, type NativeInstallResult } from "./native-runtime.js";

/**
 * What `npm install -g codex-goat` does after the files land, so that one command is the
 * whole install:
 *
 *   1. fetch the prebuilt native runtime for this platform (best-effort), and
 *   2. run the user-scope setup — skills, AGENTS guidance, hooks — when this is a global
 *      install on a real user's machine.
 *
 * Both are skipped, with a reason, in a development checkout, under `sudo` (HOME would be
 * root's), in CI, for a local dependency install, or when the user opts out. Nothing here
 * can fail the install: every path returns, and the caller exits 0 regardless.
 *
 * npm hides lifecycle output by default, so the outcome is also written to
 * `bin/.postinstall.json` for `goat doctor` to report.
 */

export interface PostinstallPlan {
  native: boolean;
  setup: boolean;
  reasons: string[];
}

export interface PostinstallEnv {
  [key: string]: string | undefined;
}

/**
 * Decide what to do, from the environment npm hands a lifecycle script.
 *
 * `npm_config_global` is how npm says `-g`; the path heuristic covers package managers
 * that do not set it: a local dependency lives at `<project>/node_modules/codex-goat`,
 * so a `package.json` two levels up means "someone's dependency, not a tool install".
 */
export function postinstallPlan(env: PostinstallEnv, root: string): PostinstallPlan {
  const reasons: string[] = [];
  if (env.GOAT_SKIP_POSTINSTALL === "1") return { native: false, setup: false, reasons: ["GOAT_SKIP_POSTINSTALL=1"] };
  if (existsSync(join(root, "src", "cli", "goat.ts"))) {
    return { native: false, setup: false, reasons: ["development checkout; build the runtime with cargo and run goat setup yourself"] };
  }

  const native = env.GOAT_SKIP_NATIVE !== "1";
  if (!native) reasons.push("native runtime skipped: GOAT_SKIP_NATIVE=1");

  let setup = true;
  const isGlobal = env.npm_config_global === "true" || !existsSync(join(root, "..", "..", "package.json"));
  if (env.GOAT_SKIP_SETUP === "1") {
    setup = false;
    reasons.push("setup skipped: GOAT_SKIP_SETUP=1");
  } else if (!isGlobal) {
    setup = false;
    reasons.push("setup skipped: installed as a project dependency, not globally");
  } else if (env.CI && env.CI !== "false" && env.CI !== "0") {
    setup = false;
    reasons.push("setup skipped: CI environment");
  } else if (env.SUDO_USER) {
    setup = false;
    reasons.push(`setup skipped: running under sudo, HOME belongs to root not ${env.SUDO_USER}; run \`goat setup --scope user\` as yourself`);
  } else if (!(env.HOME || env.USERPROFILE)) {
    setup = false;
    reasons.push("setup skipped: no HOME");
  }
  return { native, setup, reasons };
}

export interface PostinstallReport {
  version: string;
  plan: PostinstallPlan;
  native?: NativeInstallResult;
  setup?: { status: "done" | "failed"; detail: string };
}

export const POSTINSTALL_REPORT = ".postinstall.json";

export async function runPostinstall(
  env: PostinstallEnv = process.env,
  root: string = packageRoot(),
  performUserSetup?: () => string,
): Promise<PostinstallReport> {
  const version = readVersion(root);
  const plan = postinstallPlan(env, root);
  const report: PostinstallReport = { version, plan };

  if (!plan.native && !plan.setup) return report;

  if (plan.native) {
    report.native = await installNativeRuntime({ version, destDir: join(root, "bin") });
  }
  if (plan.setup && performUserSetup) {
    try {
      report.setup = { status: "done", detail: performUserSetup() };
    } catch (error) {
      report.setup = { status: "failed", detail: `${(error as Error).message}; run \`goat setup --scope user\`` };
    }
  }

  writeReport(root, report);
  return report;
}

function writeReport(root: string, report: PostinstallReport): void {
  try {
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", POSTINSTALL_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    // The report is a courtesy for `goat doctor`; a read-only package dir must not matter.
  }
}

function readReport(root: string): PostinstallReport | null {
  try {
    return JSON.parse(readFileSync(join(root, "bin", POSTINSTALL_REPORT), "utf8")) as PostinstallReport;
  } catch {
    return null;
  }
}

/**
 * The first real `goat` launch's half of the one-command promise: fetch the native runtime
 * if postinstall could not (npm gates global install scripts behind `--allow-scripts`,
 * `--ignore-scripts` skips them, pnpm and yarn may not run them). Tried once per package
 * version — a launch must not pay a network round trip every time GitHub is unreachable —
 * and recorded in the same report `goat doctor` reads.
 */
export async function ensureNativeRuntimeOnce(root: string = packageRoot(), env: PostinstallEnv = process.env): Promise<NativeInstallResult | null> {
  if (env.GOAT_SKIP_NATIVE === "1" || existsSync(join(root, "src", "cli", "goat.ts"))) return null;
  const version = readVersion(root);
  const previous = readReport(root);
  if (previous?.version === version && previous.native) return null;
  const native = await installNativeRuntime({ version, destDir: join(root, "bin"), timeoutMs: 8_000 });
  writeReport(root, { version, plan: { native: true, setup: false, reasons: ["fetched on first launch"] }, native });
  return native;
}

export function formatPostinstallReport(report: PostinstallReport): string[] {
  // A development checkout has nothing to install and nothing to say.
  if (!report.plan.native && !report.plan.setup && report.plan.reasons[0]?.startsWith("development checkout")) return [];
  const lines: string[] = [`codex-goat ${report.version} installed`];
  if (report.native) lines.push(`  native runtime: ${report.native.status} — ${report.native.detail}`);
  if (report.setup) lines.push(`  user setup:     ${report.setup.status} — ${report.setup.detail}`);
  for (const reason of report.plan.reasons) lines.push(`  note: ${reason}`);
  if (!report.setup) lines.push("  next: `goat setup --scope user` (or just run `goat`; it sets itself up on first launch)");
  lines.push("  check: goat doctor");
  return lines;
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
