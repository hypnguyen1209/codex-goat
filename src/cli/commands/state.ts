import { GoatError, log } from "../../core/log.js";
import { appendLedger } from "../../state/ledger.js";
import { readLedger } from "../../state/ledger.js";
import { checkContract } from "../../state/contract.js";
import { normalizeStageId, STAGE_IDS, STAGES } from "../../state/stages.js";
import { clearState, readState, updateStage } from "../../state/store.js";
import type { ParsedArgs } from "../args.js";
import { flagString } from "../args.js";

/**
 * The CLI surface skills use to record their own progress.
 *
 * Skills are prose; they cannot be trusted to keep state in their heads across a compaction.
 * These commands give them a durable, greppable place to put it.
 */

export function runState(parsed: ParsedArgs, cwd: string = process.cwd()): number {
  const action = parsed.positionals[0] ?? "read";

  switch (action) {
    case "read": {
      log.out(JSON.stringify(readState(cwd), null, 2));
      return 0;
    }
    case "set": {
      const stage = requireStage(parsed);
      const status = flagString(parsed.flags, "status") ?? "active";
      if (status !== "idle" && status !== "active" && status !== "complete" && status !== "blocked") {
        throw new GoatError(`Unknown --status '${status}'.`, "Use idle, active, complete, or blocked.");
      }
      const next = updateStage(
        stage,
        {
          status,
          artifact: flagString(parsed.flags, "artifact"),
          summary: flagString(parsed.flags, "summary"),
          objective: flagString(parsed.flags, "objective") ?? undefined,
        },
        cwd,
      );
      appendLedger(
        {
          stage,
          kind: status === "complete" ? "complete" : status === "blocked" ? "blocked" : "start",
          summary: flagString(parsed.flags, "summary") ?? `${STAGES[stage].invocation} -> ${status}`,
          ...(flagString(parsed.flags, "artifact") ? { artifact: flagString(parsed.flags, "artifact") as string } : {}),
        },
        cwd,
      );
      log.out(JSON.stringify(next.stages[stage], null, 2));
      return 0;
    }
    case "clear": {
      clearState(cwd);
      log.ok("state cleared");
      return 0;
    }
    default:
      throw new GoatError(`Unknown state action '${action}'.`, "Use: goat state read|set|clear");
  }
}

export function runContract(parsed: ParsedArgs, cwd: string = process.cwd()): number {
  const requested = parsed.positionals[0] ?? flagString(parsed.flags, "stage");
  const stages = requested ? [requireStageValue(requested)] : [...STAGE_IDS];

  const reports = stages.map((stage) => checkContract(stage, cwd));
  if (parsed.flags.has("json")) {
    log.out(JSON.stringify(reports, null, 2));
    return reports.every((report) => report.ready) ? 0 : 1;
  }

  for (const report of reports) {
    log.out(`${report.invocation}: ${report.ready ? "ready" : "needs input"}`);
    for (const check of report.checks) {
      log.detail(`${check.requirement}: ${check.verdict} — ${check.detail}`);
    }
    if (report.suggestion) log.detail(report.suggestion);
  }
  return reports.every((report) => report.ready) ? 0 : 1;
}

export function runLedger(parsed: ParsedArgs, cwd: string = process.cwd()): number {
  const action = parsed.positionals[0] ?? "read";

  if (action === "read") {
    const limit = Number.parseInt(flagString(parsed.flags, "limit") ?? "50", 10);
    for (const entry of readLedger(Number.isFinite(limit) ? limit : 50, cwd)) {
      log.out(JSON.stringify(entry));
    }
    return 0;
  }

  if (action === "evidence") {
    const stage = requireStage(parsed);
    const command = parsed.passthrough.join(" ").trim();
    if (!command) {
      throw new GoatError("No command supplied.", "Usage: goat ledger evidence --stage plan -- npm test");
    }
    const exitCode = Number.parseInt(flagString(parsed.flags, "exit") ?? "0", 10);
    updateStage(stage, { evidence: [{ command, exitCode, at: new Date().toISOString() }] }, cwd);
    appendLedger({ stage, kind: "evidence", summary: command, command, exitCode }, cwd);
    log.ok(`evidence recorded for ${STAGES[stage].invocation}`);
    return 0;
  }

  if (action === "note") {
    const stage = requireStage(parsed);
    const summary = flagString(parsed.flags, "note") ?? parsed.positionals.slice(1).join(" ");
    if (!summary) throw new GoatError("No note supplied.", 'Usage: goat ledger note --stage plan --note "..."');
    appendLedger({ stage, kind: "note", summary }, cwd);
    log.ok("note recorded");
    return 0;
  }

  throw new GoatError(`Unknown ledger action '${action}'.`, "Use: goat ledger read|evidence|note");
}

function requireStage(parsed: ParsedArgs) {
  const raw = flagString(parsed.flags, "stage");
  if (!raw) throw new GoatError("--stage is required.", `Stages: ${STAGE_IDS.join(", ")}`);
  return requireStageValue(raw);
}

function requireStageValue(raw: string) {
  const stage = normalizeStageId(raw);
  if (!stage) throw new GoatError(`Unknown stage '${raw}'.`, `Stages: ${STAGE_IDS.join(", ")}`);
  return stage;
}
