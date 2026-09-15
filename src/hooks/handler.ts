import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../core/fsx.js";
import { findProjectRoot, goatPaths } from "../core/paths.js";
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
      if (typeof message === "string" && message.length > 0 && memoryConfig(cwd).enabled) {
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
      // A stage still in flight carries its failures with it. Until 0.1.6 they were only
      // inspected once a stage was `complete`, so three recorded `npm test -> exit 1` runs
      // resumed as zero and the three-failures rule in AGENTS.md started over.
      const failing = stage.evidence.filter((ref) => ref.exitCode !== 0);
      const last = failing[failing.length - 1];
      const failures = last ? ` — ${failing.length} failing command(s), last: ${last.command} -> exit ${last.exitCode}` : "";
      return `- ${STAGES[id].invocation}: ${stage.status}${stage.artifact ? ` (${stage.artifact})` : ""}${failures}`;
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

  // Nothing renders how old the rehydrated state is, and AGENTS.md says to resume from the
  // first unfinished item unconditionally — a three-week-old objective resumed exactly like
  // one from an hour ago. One line, only when something was actually rehydrated: a fresh
  // repo's emptyState() stamps updatedAt = now and must not produce it.
  if (blocks.length > 0) {
    const ageSeconds = (Date.now() - Date.parse(state.updatedAt)) / 1000;
    if (Number.isFinite(ageSeconds)) {
      const stale = ageSeconds > 7 * 86_400 ? " — confirm it is still current before resuming" : "";
      blocks.push(`Last codex-goat activity: ${describeAge(ageSeconds)} ago (${state.updatedAt})${stale}`);
    }
  }

  const memory = memoryConfig(cwd);
  if (memory.enabled) {
    const digest = memoryDigest(memory.digestSize, cwd);
    if (digest) blocks.push(digest);
  }

  const guidance = readOptional(join(goatPaths(cwd).root, "SESSION.md"));
  if (guidance) blocks.push(capSessionNotes(guidance.trim()));

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/**
 * Codex replaces any hook context over ~2,500 tokens with a head/tail preview and a path
 * (codex-rs/hooks/src/output_spill.rs), which would take the objective and the stage list
 * down with the notes. Cap the one unbounded block well under that and point at the file,
 * which the model can read on demand.
 */
const SESSION_NOTES_MAX_CHARS = 4_000;

function capSessionNotes(notes: string): string {
  if (notes.length <= SESSION_NOTES_MAX_CHARS) return notes;
  return `${notes.slice(0, SESSION_NOTES_MAX_CHARS)}\n… (truncated; read .goat/SESSION.md for the rest)`;
}

/**
 * `.goat/config.json` has carried `memory: { enabled, digestSize }` since `goat setup` first
 * wrote it, and until 0.1.6 nothing read it. Mirrors `memory_config` in
 * crates/goat-runtime/src/state.rs. `GOAT_MEMORY=off` wins over the file, so a user who
 * turns on Codex's native memories can silence goat's without editing anything.
 */
export function memoryConfig(cwd: string): { enabled: boolean; digestSize: number } {
  if ((process.env.GOAT_MEMORY ?? "").trim().toLowerCase() === "off") return { enabled: false, digestSize: 8 };
  const config = readJson<{ memory?: { enabled?: unknown; digestSize?: unknown } }>(goatPaths(cwd).config, {});
  const enabled = config.memory?.enabled !== false;
  const size = config.memory?.digestSize;
  const digestSize = typeof size === "number" && Number.isFinite(size) && size >= 1 && size <= 50 ? Math.floor(size) : 8;
  return { enabled, digestSize };
}

/** `3 minutes`, `5 hours`, `12 days` — coarse on purpose; a resumed session needs the order of magnitude. */
export function describeAge(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return "moments";
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86_400)} days`;
}

/**
 * When a prompt invokes a canonical stage, attach that stage's entry-contract report.
 * This is the mechanism behind "each stage is independently invocable": the model is told
 * exactly which requirements are already satisfied and which it must gather inline.
 */
function userPromptContext(prompt: string, sessionId: string, cwd: string): string | null {
  if (memoryConfig(cwd).enabled) recordObservation({ sessionId, kind: "prompt", text: prompt }, cwd);

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
  // Only worth saying when there is an `inline` requirement to say it about. On $clarify,
  // which has no prerequisites at all, it printed under "- no prerequisites" and named both
  // a requirement category the stage cannot have and an earlier stage that does not exist.
  if (report.checks.some((check) => check.verdict === "inline")) {
    parts.push(
      "Stages are independent: satisfy any 'inline' requirement from the user's message and proceed. Do not force an earlier stage.",
    );
  }
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
