import { appendJsonl, readJsonl } from "../core/fsx.js";
import { goatPaths } from "../core/paths.js";
import type { StageId } from "./stages.js";

/**
 * Append-only record of everything a stage claimed and everything that proved it.
 *
 * The ledger exists so "done" is auditable after the fact. `goat status` reconciles it
 * against `state.json`; a stage marked complete with no `evidence` entry is reported as
 * an unproven claim rather than a success.
 */

export type LedgerKind = "start" | "artifact" | "evidence" | "complete" | "blocked" | "note";

export interface LedgerEntry {
  ts: string;
  stage: StageId;
  kind: LedgerKind;
  summary: string;
  artifact?: string;
  command?: string;
  exitCode?: number;
}

export function appendLedger(entry: Omit<LedgerEntry, "ts">, cwd: string = process.cwd()): LedgerEntry {
  const full: LedgerEntry = { ts: new Date().toISOString(), ...entry };
  appendJsonl(goatPaths(cwd).ledger, full);
  return full;
}

export function readLedger(limit = 200, cwd: string = process.cwd()): LedgerEntry[] {
  return readJsonl<LedgerEntry>(goatPaths(cwd).ledger, limit).filter(isLedgerEntry);
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LedgerEntry>;
  return typeof candidate.ts === "string" && typeof candidate.stage === "string" && typeof candidate.kind === "string";
}
