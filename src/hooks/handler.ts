import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../core/paths.js";
import { checkContract } from "../state/contract.js";
import { memoryDigest, recordObservation } from "../state/memory.js";
import { normalizeStageId, STAGES, type StageId } from "../state/stages.js";
import { readState, unprovenReason } from "../state/store.js";

/**
 * The one hook handler, for every Codex lifecycle event codex-goat subscribes to.
 *
 * Contract (from Codex's own hook schema):
 *   - input  arrives on stdin, snake_case: `hook_event_name`, `cwd`, `prompt`, ...
 *   - output goes to stdout, camelCase, and rejects unknown fields.
 *
 * Rules this handler follows without exception:
 *   1. Never block. No event ever returns a `block` decision — a broken helper must not
 *      be able to stop the user's session.
 *   2. Never throw. Any failure degrades to empty output and exit 0.
 *   3. Stay cheap, and never touch the network. Local file reads, plus at most one
 *      `git status --porcelain` with a 5s timeout — and only when the prompt explicitly
 *      invokes a stage whose contract depends on the working tree. Ordinary prompts run
 *      no subprocess at all.
 */

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  last_assistant_message?: string | null;
  [key: string]: unknown;
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
}

export function handleHook(input: HookInput): HookOutput {
  const event = String(input.hook_event_name ?? "");
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const sessionId = String(input.session_id ?? "unknown");

  switch (event) {
    case "SessionStart":
      return context(event, sessionStartContext(cwd));
    case "UserPromptSubmit":
      return context(event, userPromptContext(String(input.prompt ?? ""), sessionId, cwd));
    case "Stop": {
      const message = input.last_assistant_message;
      if (typeof message === "string" && message.length > 0) {
        recordObservation({ sessionId, kind: "result", text: message }, cwd);
      }
      return {};
    }
    default:
      return {};
  }
}

function context(event: string, additionalContext: string | null): HookOutput {
  if (!additionalContext) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/** Rehydrate a resumed session: where the workflow stands, plus a memory digest. */
function sessionStartContext(cwd: string): string | null {
  const blocks: string[] = [];
  const state = readState(cwd);

  const inFlight = (Object.keys(state.stages) as StageId[]).filter(
    (id) => state.stages[id].status === "active" || state.stages[id].status === "blocked",
  );
  const done = (Object.keys(state.stages) as StageId[]).filter((id) => state.stages[id].status === "complete");

  if (state.objective) blocks.push(`Active codex-goat objective: ${state.objective}`);
  if (inFlight.length > 0) {
    const lines = inFlight.map((id) => {
      const stage = state.stages[id];
      return `- ${STAGES[id].invocation}: ${stage.status}${stage.artifact ? ` (${stage.artifact})` : ""}`;
    });
    blocks.push(`Stages in flight:\n${lines.join("\n")}`);
  }
  if (done.length > 0) {
    const lines = done.map((id) => {
      const stage = state.stages[id];
      // Same predicate `goat status` uses, so a resumed session and the CLI never
      // disagree about which claims are actually backed.
      const reason = unprovenReason(stage, id, findProjectRoot(cwd));
      const proof = reason === null ? `${stage.evidence.length} evidence entr(ies)` : `UNPROVEN — ${reason}`;
      return `- ${STAGES[id].invocation}: complete, ${proof}`;
    });
    blocks.push(`Stages already complete:\n${lines.join("\n")}`);
  }

  const digest = memoryDigest(8, cwd);
  if (digest) blocks.push(digest);

  const guidance = readOptional(join(findProjectRoot(cwd), ".goat", "SESSION.md"));
  if (guidance) blocks.push(guidance.trim());

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/**
 * When a prompt invokes a canonical stage, attach that stage's entry-contract report.
 * This is the mechanism behind "each stage is independently invocable": the model is told
 * exactly which requirements are already satisfied and which it must gather inline.
 */
function userPromptContext(prompt: string, sessionId: string, cwd: string): string | null {
  recordObservation({ sessionId, kind: "prompt", text: prompt }, cwd);

  const stage = detectStage(prompt);
  if (!stage) return null;

  const report = checkContract(stage, cwd);
  const lines = report.checks.map((check) => `- ${check.requirement}: ${check.verdict} — ${check.detail}`);
  const parts = [
    `codex-goat entry contract for ${report.invocation} (${STAGES[stage].summary})`,
    lines.length > 0 ? lines.join("\n") : "- no prerequisites",
    `Produces: ${STAGES[stage].produces}`,
  ];
  if (report.suggestion) parts.push(report.suggestion);
  parts.push(
    "Stages are independent: satisfy any 'inline' requirement from the user's message and proceed. Do not force an earlier stage.",
  );
  return parts.join("\n");
}

/**
 * Matches an explicit invocation: `$plan` or `/plan`.
 *
 * The sigil is required. v0.1.0 also accepted a bare leading word, which meant ordinary
 * prose — "plan the migration", "team review this" — was treated as a stage invocation
 * and paid for a contract report, including its `git status` probe. Every skill and every
 * doc spells these with a sigil, so requiring one costs nothing.
 */
export function detectStage(prompt: string): StageId | null {
  const match = prompt.match(/(?:^|\s)[$/]([a-z][a-z-]*)/i);
  return match?.[1] ? normalizeStageId(match[1]) : null;
}

function readOptional(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Entry point shared by the plugin hook script and `goat hook`. */
export function runHookFromStdin(raw: string): string {
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return "{}";
  }
  try {
    return JSON.stringify(handleHook(input));
  } catch {
    return "{}";
  }
}
