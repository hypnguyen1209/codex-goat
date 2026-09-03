/**
 * The canonical workflow, expressed as entry contracts rather than a chain.
 *
 * codex-goat deliberately does NOT hard-wire clarify -> plan -> execute -> review -> qa.
 * Each stage declares what it needs to start (`requires`) and what it leaves behind
 * (`produces`). A stage is invocable the moment its requirements are satisfiable — by a
 * previous stage's artifact, by the working tree, or by the user simply saying it inline.
 *
 * That is the whole difference between "one consistent workflow" and "a fixed pipeline".
 */

export const STAGE_IDS = [
  "clarify",
  "plan",
  "ultragoal",
  "team",
  "code-review",
  "ultraqa",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export type RequirementKind =
  | "objective" // a stated goal, from the user or a prior artifact
  | "plan" // an approved plan artifact
  | "changed-scope" // a diff, branch, or explicit file set
  | "runnable" // a command or service that can actually be executed
  | "parallel-lanes"; // 2+ independent workstreams

export interface StageSpec {
  readonly id: StageId;
  /** The `$name` a user types inside Codex. */
  readonly invocation: string;
  readonly summary: string;
  /** Every requirement must be satisfiable before the stage may claim completion. */
  readonly requires: readonly RequirementKind[];
  /** Requirements the user can satisfy inline, without any prior stage. */
  readonly inlineSatisfiable: readonly RequirementKind[];
  readonly produces: string;
  /** Where the stage writes its durable artifact, relative to `.goat/`. */
  readonly artifactDir: string;
  /**
   * What backs a completion claim for this stage.
   *
   * `"command"` stages assert that behaviour works, so they need a recorded command that
   * exited 0. `"artifact"` stages produce a document; the document existing on disk is
   * the proof, because there is no command that makes a plan true. Both kinds still fail
   * when a recorded artifact is missing — v0.1.4 accepted a path that was never written.
   */
  readonly proof: "artifact" | "command";
  /** Stages that most often precede this one — a suggestion, never a gate. */
  readonly commonlyAfter: readonly StageId[];
}

export const STAGES: Record<StageId, StageSpec> = {
  clarify: {
    id: "clarify",
    invocation: "$clarify",
    summary: "Socratic ambiguity clearance until the request is execution-ready.",
    requires: [],
    inlineSatisfiable: [],
    produces: "requirements artifact with open questions resolved and scope frozen",
    artifactDir: "plans",
    proof: "artifact",
    commonlyAfter: [],
  },
  plan: {
    id: "plan",
    invocation: "$plan",
    summary: "Evidence-backed plan with testable acceptance criteria.",
    requires: ["objective"],
    inlineSatisfiable: ["objective"],
    produces: "plan artifact under .goat/plans/",
    artifactDir: "plans",
    proof: "artifact",
    commonlyAfter: ["clarify"],
  },
  ultragoal: {
    id: "ultragoal",
    invocation: "$ultragoal",
    summary: "Durable multi-goal execution with a checkpoint ledger.",
    requires: ["objective", "plan"],
    inlineSatisfiable: ["objective", "plan"],
    produces: "goal ledger under .goat/goals/ with per-checkpoint evidence",
    artifactDir: "goals",
    proof: "command",
    commonlyAfter: ["plan", "clarify"],
  },
  team: {
    id: "team",
    invocation: "$team",
    summary: "Coordinated parallel execution across independent lanes.",
    requires: ["objective", "parallel-lanes"],
    inlineSatisfiable: ["objective", "parallel-lanes"],
    produces: "lane assignments and merged evidence under .goat/goals/",
    artifactDir: "goals",
    proof: "command",
    commonlyAfter: ["plan", "ultragoal"],
  },
  "code-review": {
    id: "code-review",
    invocation: "$code-review",
    summary: "Multi-dimension review of a concrete change, each finding verified.",
    requires: ["changed-scope"],
    inlineSatisfiable: ["changed-scope"],
    produces: "review report under .goat/reviews/",
    artifactDir: "reviews",
    proof: "artifact",
    commonlyAfter: [],
  },
  ultraqa: {
    id: "ultraqa",
    invocation: "$ultraqa",
    summary: "Adversarial dynamic end-to-end QA against real execution.",
    requires: ["runnable"],
    inlineSatisfiable: ["runnable"],
    produces: "QA report and scenario matrix under .goat/qa/",
    artifactDir: "qa",
    proof: "command",
    commonlyAfter: ["ultragoal", "team", "code-review"],
  },
};

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

/** Accepts `plan`, `$plan`, `/plan`, `--plan`. Users type all four. */
export function normalizeStageId(value: string): StageId | null {
  const cleaned = value.trim().replace(/^[$/]|^--/, "").toLowerCase();
  return isStageId(cleaned) ? cleaned : null;
}
