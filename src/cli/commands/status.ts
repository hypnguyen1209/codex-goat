import { color, log } from "../../core/log.js";
import { checkContract } from "../../state/contract.js";
import { readLedger } from "../../state/ledger.js";
import { STAGE_IDS, STAGES } from "../../state/stages.js";
import { readState } from "../../state/store.js";

/**
 * Reconcile claims against proof.
 *
 * A stage marked `complete` with zero recorded evidence is reported as an unproven claim.
 * That single rule is the main defense against an agent declaring victory it never earned.
 */
export function runStatus(cwd: string = process.cwd()): number {
  const state = readState(cwd);

  log.out(color.bold("codex-goat status"));
  log.out(`objective: ${state.objective ?? color.dim("(none recorded)")}`);
  log.out("");

  let unproven = 0;
  for (const id of STAGE_IDS) {
    const stage = state.stages[id];
    const spec = STAGES[id];
    const contract = checkContract(id, cwd);

    const badge =
      stage.status === "complete"
        ? stage.evidence.length > 0
          ? color.green("complete")
          : color.yellow("complete*")
        : stage.status === "active"
          ? color.cyan("active")
          : stage.status === "blocked"
            ? color.red("blocked")
            : color.dim("idle");

    if (stage.status === "complete" && stage.evidence.length === 0) unproven += 1;

    const readiness = contract.ready ? "ready" : "needs input";
    log.out(`${spec.invocation.padEnd(14)} ${badge}  ${color.dim(readiness)}`);
    if (stage.artifact) log.detail(`artifact: ${stage.artifact}`);
    if (stage.evidence.length > 0) {
      const last = stage.evidence[stage.evidence.length - 1];
      if (last) log.detail(`last evidence: ${last.command} -> exit ${last.exitCode}`);
    }
    for (const check of contract.checks) {
      if (check.verdict !== "satisfied") log.detail(`${check.requirement}: ${check.verdict} — ${check.detail}`);
    }
  }

  const recent = readLedger(5, cwd);
  if (recent.length > 0) {
    log.out("");
    log.out(color.bold("recent ledger"));
    for (const entry of recent) {
      log.out(`  ${entry.ts}  ${entry.stage}/${entry.kind}  ${entry.summary}`);
    }
  }

  if (unproven > 0) {
    log.out("");
    log.warn(`${unproven} stage(s) marked complete with no recorded evidence (shown as complete*).`);
    log.detail("Record proof with: goat ledger evidence --stage <stage> -- <command>");
    return 1;
  }
  return 0;
}
