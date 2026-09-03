import { existsSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../core/paths.js";
import { runCapture } from "../core/proc.js";
import type { RequirementKind, StageId } from "./stages.js";
import { STAGES } from "./stages.js";
import { readState } from "./store.js";

/**
 * Answers one question: "can I start `$stage` right now, and if not, what is missing?"
 *
 * This is what makes the five canonical skills independently invocable. Nothing here
 * blocks execution — it reports. A requirement the user can satisfy by simply stating it
 * is reported as `inline`, not as a failure.
 */

/**
 * Only two verdicts exist, and that is the point.
 *
 * There is deliberately no "missing": a stage is never hard-blocked, because a
 * requirement the user can state in their own message is not an obstacle. The type
 * carried a third `"missing"` case in v0.1.0 that nothing ever produced, which made the
 * readiness filter a tautology and hid the invariant behind an unreachable branch.
 */
export type RequirementVerdict = "satisfied" | "inline";

export interface RequirementCheck {
  requirement: RequirementKind;
  verdict: RequirementVerdict;
  detail: string;
}

export interface ContractReport {
  stage: StageId;
  invocation: string;
  /**
   * Always true. Kept so callers can render it and so the guarantee is visible in the
   * report itself; it is not a gate, and no command should branch on it failing.
   */
  ready: true;
  checks: RequirementCheck[];
  suggestion: string | null;
}

export function checkContract(stage: StageId, cwd: string = process.cwd()): ContractReport {
  const spec = STAGES[stage];
  const state = readState(cwd);
  const root = findProjectRoot(cwd);

  const checks = spec.requires.map((requirement): RequirementCheck => {
    switch (requirement) {
      case "objective": {
        if (state.objective) {
          return { requirement, verdict: "satisfied", detail: `objective on record: ${truncate(state.objective)}` };
        }
        const clarify = state.stages.clarify;
        // The artifact must be on disk, not merely recorded. A stale path is not an
        // objective, and reporting it as satisfied sends the stage off with nothing.
        if (clarify.status === "complete" && clarify.artifact && existsSync(join(root, clarify.artifact))) {
          return { requirement, verdict: "satisfied", detail: `from $clarify artifact ${clarify.artifact}` };
        }
        return { requirement, verdict: "inline", detail: "state the objective in the invocation" };
      }

      case "plan": {
        const plan = state.stages.plan;
        if (plan.status === "complete" && plan.artifact && existsSync(join(root, plan.artifact))) {
          return { requirement, verdict: "satisfied", detail: `plan artifact ${plan.artifact}` };
        }
        if (plan.status === "complete") {
          return { requirement, verdict: "inline", detail: "plan marked complete but artifact is missing on disk" };
        }
        return { requirement, verdict: "inline", detail: "supply an approved plan inline, or run $plan first" };
      }

      case "changed-scope": {
        const changed = changedFiles(root);
        if (changed.length > 0) {
          return { requirement, verdict: "satisfied", detail: `${changed.length} changed file(s) vs HEAD` };
        }
        return { requirement, verdict: "inline", detail: "name a commit range, branch, or explicit file set" };
      }

      case "runnable": {
        const found = RUNNABLE_MARKERS.filter((marker) => existsSync(join(root, marker)));
        if (found.length > 0) {
          return { requirement, verdict: "satisfied", detail: `runnable project detected (${found.join(", ")})` };
        }
        return { requirement, verdict: "inline", detail: "give the exact command or service to exercise" };
      }

      case "parallel-lanes": {
        const plan = state.stages.plan;
        if (plan.status === "complete" && plan.artifact && existsSync(join(root, plan.artifact))) {
          return { requirement, verdict: "satisfied", detail: `derive lanes from ${plan.artifact}` };
        }
        return { requirement, verdict: "inline", detail: "describe 2+ independent lanes, or $team caps to one worker" };
      }

      default:
        return { requirement, verdict: "inline", detail: "state it in the invocation" };
    }
  });

  // Always true, and deliberately so: every requirement is either already satisfied or
  // satisfiable from the user's message, so a stage can always start. `ready` is kept as
  // a field because callers render it, not because it can be false.
  return {
    stage,
    invocation: spec.invocation,
    ready: true,
    checks,
    suggestion: suggestFor(stage, checks),
  };
}

const RUNNABLE_MARKERS = [
  "package.json",
  "Makefile",
  "justfile",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "docker-compose.yml",
] as const;

function changedFiles(root: string): string[] {
  const result = runCapture("git", ["status", "--porcelain"], { cwd: root, timeoutMs: 5000 });
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function suggestFor(stage: StageId, checks: RequirementCheck[]): string | null {
  const inline = checks.filter((check) => check.verdict === "inline");
  if (inline.length === 0) return null;
  const spec = STAGES[stage];
  const upstream = spec.commonlyAfter[0];
  const items = inline.map((check) => check.requirement).join(", ");
  return upstream
    ? `Provide ${items} inline, or run ${STAGES[upstream].invocation} first.`
    : `Provide ${items} inline.`;
}

function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
