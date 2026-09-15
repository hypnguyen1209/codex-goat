import { readJson } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import type { StageId } from "./stages.js";

/**
 * Which model to launch for which stage.
 *
 * One Codex session runs one model, so a stage cannot switch models mid-conversation.
 * What makes per-stage routing work is that `.goat/` is durable: `$plan` writes an
 * artifact, the session ends, and a new session running a different model picks it up
 * through the same entry contract. The split is across sessions, not within one.
 *
 * The defaults below are grounded in how Codex positions its models, and in one latency
 * measurement. Neither is a quality measurement — see the caveat on `DEFAULT_ROUTES`.
 */

export interface StageRoute {
  model?: string;
  effort?: string;
  /**
   * Oldest Codex CLI whose catalog can serve `model`. Codex's own catalog carries this as
   * `minimal_client_version`, and the server refuses the model to older clients with
   * "requires a newer version of Codex". Below it, `fallback` is launched instead.
   */
  minCodex?: string;
  fallback?: string;
}

/**
 * Judgement stages get Codex's current default model; execution stages get the faster one.
 *
 * Evidence for the split, from the Codex model catalog (codex-rs/models-manager/models.json)
 * and this repo's benchmark:
 *  - `gpt-6-astra` is priority 1 and therefore Codex's default for a fresh install. It is
 *    served only to Codex >= 0.153.0 (`minimal_client_version`); older installs fall back
 *    to `gpt-5.6-sol`, which was the default before it, at priority 6 now.
 *  - `gpt-5.6-luna` sits at priority 8 and is what Codex routes its own auxiliary work to.
 *    Measured here: luna finished faster in all six model x effort cells and carries a
 *    1,558-token lighter always-on prefix.
 *
 * What is NOT evidence: output quality. Nothing in this repo grades correctness, and the
 * task benchmark could not separate sol from luna on token use at all (per-task direction
 * swung from -58% to +176%). Astra has not been benchmarked here at all. Treat these as a
 * sensible default to override, not a measured optimum.
 */
export const DEFAULT_ROUTES: Readonly<Record<StageId, StageRoute>> = {
  clarify: { model: "gpt-6-astra", effort: "high", minCodex: "0.153.0", fallback: "gpt-5.6-sol" },
  plan: { model: "gpt-6-astra", effort: "high", minCodex: "0.153.0", fallback: "gpt-5.6-sol" },
  "code-review": { model: "gpt-6-astra", effort: "high", minCodex: "0.153.0", fallback: "gpt-5.6-sol" },
  ultragoal: { model: "gpt-5.6-luna" },
  team: { model: "gpt-5.6-luna" },
  ultraqa: { model: "gpt-5.6-luna" },
};

/**
 * Why the three judgement stages pin `effort` and the three execution stages do not.
 *
 * `high` is what `goat` injects by default, so pinning it changes nothing today. It is
 * written down because these three are the stages whose entire output is a judgement, and
 * a future change to the global default must not quietly lower them.
 *
 * The execution stages are deliberately left unpinned rather than dropped to `medium`.
 * Dropping them is worth a measured -275 generated tokens per turn at the benchmark
 * medians, which is real money — but that benchmark is a generic task set containing no
 * $ultragoal, $team or $ultraqa work, and the thing that makes codex-goat cheaper is the
 * model answering in one pass instead of two. No run in bench/ records that one-call rate
 * at any effort but medium. Lowering effort on the stages that do the work, on evidence
 * that never observed them, is the trade this file already warns against.
 */

interface GoatConfig {
  routes?: Partial<Record<StageId, StageRoute>>;
}

/**
 * Resolve the route for a stage, letting `.goat/config.json` override the default.
 *
 * A config entry replaces only the fields it sets, so a user can pin an effort without
 * also having to restate the model.
 */
export function routeFor(stage: StageId, cwd: string = process.cwd()): StageRoute {
  const config = readJson<GoatConfig>(goatPaths(cwd).config, {});
  const override = config.routes?.[stage] ?? {};
  return { ...DEFAULT_ROUTES[stage], ...override };
}

/** Every stage's resolved route, for `goat skills` and `goat doctor` to display. */
export function allRoutes(cwd: string = process.cwd()): Record<StageId, StageRoute> {
  const out = {} as Record<StageId, StageRoute>;
  for (const stage of Object.keys(DEFAULT_ROUTES) as StageId[]) out[stage] = routeFor(stage, cwd);
  return out;
}

export interface ResolvedModel {
  model: string;
  /** Set when the installed Codex could not serve the routed model and `fallback` was used. */
  note?: string;
}

/**
 * Pick the model to actually launch, given the installed Codex version.
 *
 * A route that names a `minCodex` is honoured only when the installed CLI is at least
 * that old; otherwise its `fallback` is used and the caller is told why, because a
 * wrapper that silently swaps models is exactly what `--print-argv` exists to prevent.
 * An unreadable version is treated as too old: launching a model the server will refuse
 * is a worse failure than launching the previous default.
 */
export function resolveRouteModel(route: StageRoute, codexVersion: string | null): ResolvedModel | null {
  if (!route.model) return null;
  if (!route.minCodex || !route.fallback) return { model: route.model };
  if (codexVersion === null) {
    return {
      model: route.fallback,
      note: `${route.model} needs Codex >= ${route.minCodex} and the installed version could not be read; using ${route.fallback}`,
    };
  }
  if (compareVersions(codexVersion, route.minCodex) < 0) {
    return {
      model: route.fallback,
      note: `${route.model} needs Codex >= ${route.minCodex} (installed ${codexVersion}); using ${route.fallback}`,
    };
  }
  return { model: route.model };
}

/** Pull `0.147.0` out of `codex-cli 0.147.0` or any string that carries a dotted triple. */
export function parseCodexVersion(output: string): string | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** Numeric major.minor.patch comparison; pre-release suffixes are ignored on purpose. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
