import { readJson, writeJsonAtomic } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import type { StageId } from "./stages.js";
import { STAGE_IDS } from "./stages.js";

export const STATE_VERSION = 1;

export type StageStatus = "idle" | "active" | "complete" | "blocked";

export interface StageState {
  status: StageStatus;
  /** Relative path (from the project root) of the artifact this stage produced. */
  artifact: string | null;
  summary: string | null;
  updatedAt: string | null;
  /**
   * Commands recorded against this stage. Presence is not proof — see
   * {@link isSubstantiveEvidence}, which is what decides whether a claim is backed.
   */
  evidence: EvidenceRef[];
}

export interface EvidenceRef {
  command: string;
  exitCode: number;
  at: string;
  note?: string;
}

/**
 * Shell no-ops that exit 0 without checking anything.
 *
 * This list is a lint against lazy proof, not a security control: `bash -c true` defeats
 * it trivially. It exists because the cheap way to satisfy an evidence gate is to record
 * something that always succeeds, and that should be called out rather than counted.
 */
const NO_OP_COMMANDS = new Set(["true", ":", "echo", "printf", "exit", "cd", "sleep", "noop"]);

/**
 * Does this record actually back a completion claim?
 *
 * A non-zero exit code is the load-bearing check. Recording a failing command and calling
 * the stage done is the exact failure this gate exists to catch, and for the first release
 * the exit code was stored, written to the ledger, and printed — but never compared.
 */
export function isSubstantiveEvidence(ref: EvidenceRef): boolean {
  if (ref.exitCode !== 0) return false;
  const command = ref.command.trim();
  if (command.length === 0) return false;
  const firstToken = command.split(/\s+/)[0] ?? "";
  return !NO_OP_COMMANDS.has(firstToken);
}

/** Why a stage's evidence does not back its claim, or null when it does. */
export function unprovenReason(stage: StageState): string | null {
  if (stage.evidence.length === 0) return "no evidence recorded";
  if (stage.evidence.some(isSubstantiveEvidence)) return null;

  const failing = stage.evidence.filter((ref) => ref.exitCode !== 0);
  if (failing.length === stage.evidence.length) {
    const last = failing[failing.length - 1];
    return `every recorded command failed (last: ${last?.command} -> exit ${last?.exitCode})`;
  }
  return "every recorded command is a shell no-op";
}

export interface GoatState {
  version: number;
  updatedAt: string;
  objective: string | null;
  active: StageId | null;
  stages: Record<StageId, StageState>;
}

function emptyStage(): StageState {
  return { status: "idle", artifact: null, summary: null, updatedAt: null, evidence: [] };
}

export function emptyState(): GoatState {
  const stages = {} as Record<StageId, StageState>;
  for (const id of STAGE_IDS) stages[id] = emptyStage();
  return {
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    objective: null,
    active: null,
    stages,
  };
}

/**
 * Read state, repairing anything unexpected rather than throwing. A corrupt state file
 * must never be able to block a session — the worst acceptable outcome is losing history.
 */
export function readState(cwd: string = process.cwd()): GoatState {
  const raw = readJson<Partial<GoatState> | null>(goatPaths(cwd).stateFile, null);
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;

  const stages = base.stages;
  const rawStages = (raw.stages ?? {}) as Partial<Record<StageId, Partial<StageState>>>;
  for (const id of STAGE_IDS) {
    const incoming = rawStages[id];
    if (!incoming) continue;
    stages[id] = {
      status: normalizeStatus(incoming.status),
      artifact: typeof incoming.artifact === "string" ? incoming.artifact : null,
      summary: typeof incoming.summary === "string" ? incoming.summary : null,
      updatedAt: typeof incoming.updatedAt === "string" ? incoming.updatedAt : null,
      evidence: Array.isArray(incoming.evidence)
        ? incoming.evidence.filter(isEvidenceRef)
        : [],
    };
  }

  return {
    version: STATE_VERSION,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
    objective: typeof raw.objective === "string" ? raw.objective : null,
    active: typeof raw.active === "string" && (STAGE_IDS as readonly string[]).includes(raw.active)
      ? (raw.active as StageId)
      : null,
    stages,
  };
}

export function writeState(state: GoatState, cwd: string = process.cwd()): GoatState {
  const next: GoatState = { ...state, version: STATE_VERSION, updatedAt: new Date().toISOString() };
  writeJsonAtomic(goatPaths(cwd).stateFile, next);
  return next;
}

export interface StagePatch {
  status?: StageStatus;
  artifact?: string | null;
  summary?: string | null;
  evidence?: EvidenceRef[];
  objective?: string | null;
}

export function updateStage(stage: StageId, patch: StagePatch, cwd: string = process.cwd()): GoatState {
  const state = readState(cwd);
  const current = state.stages[stage];
  const now = new Date().toISOString();

  state.stages[stage] = {
    status: patch.status ?? current.status,
    artifact: patch.artifact === undefined ? current.artifact : patch.artifact,
    summary: patch.summary === undefined ? current.summary : patch.summary,
    updatedAt: now,
    // Evidence accumulates. A later run never erases proof an earlier run recorded.
    evidence: patch.evidence ? [...current.evidence, ...patch.evidence] : current.evidence,
  };
  if (patch.objective !== undefined) state.objective = patch.objective;
  state.active = (patch.status ?? current.status) === "active" ? stage : state.active === stage ? null : state.active;

  return writeState(state, cwd);
}

export function clearState(cwd: string = process.cwd()): GoatState {
  return writeState(emptyState(), cwd);
}

function normalizeStatus(value: unknown): StageStatus {
  return value === "active" || value === "complete" || value === "blocked" ? value : "idle";
}

function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EvidenceRef>;
  return typeof candidate.command === "string" && typeof candidate.exitCode === "number";
}
