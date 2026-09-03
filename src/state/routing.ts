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
 * The defaults below are grounded in two things, and neither of them is a quality
 * measurement — see the caveat on `DEFAULT_ROUTES`.
 */

export interface StageRoute {
  model?: string;
  effort?: string;
}

/**
 * Deliberation stages get Codex's flagship; execution stages get the faster model.
 *
 * Evidence for the split:
 *  - Codex ranks `gpt-5.6-sol` priority 0 in its own model catalog and uses it as the
 *    default, with `gpt-5.6-luna` at priority 2.
 *  - Codex itself routes auxiliary work to luna: approval review, memory extraction,
 *    and guardian scoring all name it explicitly.
 *  - Measured here: luna finished faster in all six model x effort cells and carries a
 *    1,558-token lighter always-on prefix.
 *
 * What is NOT evidence: output quality. Nothing in this repo grades correctness, and the
 * task benchmark could not separate the two models on token use at all (per-task
 * direction swung from -58% to +176%). Treat these as a sensible default to override,
 * not a measured optimum.
 */
export const DEFAULT_ROUTES: Readonly<Record<StageId, StageRoute>> = {
  clarify: { model: "gpt-5.6-sol" },
  plan: { model: "gpt-5.6-sol" },
  "code-review": { model: "gpt-5.6-sol" },
  ultragoal: { model: "gpt-5.6-luna" },
  team: { model: "gpt-5.6-luna" },
  ultraqa: { model: "gpt-5.6-luna" },
};

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
