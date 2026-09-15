/**
 * Merge codex-goat's hook registrations into a Codex `hooks.json` without disturbing
 * anyone else's entries.
 *
 * Ownership is decided by the command string containing `GOAT_HOOK_MARKER`. Only entries
 * carrying that marker are ever rewritten or removed, so a user's hooks — and another
 * tool's hooks — survive install, refresh, and uninstall untouched.
 */

export const GOAT_HOOK_MARKER = "goat-hook.mjs";

export const GOAT_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
export type GoatHookEvent = (typeof GOAT_HOOK_EVENTS)[number];

export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  /** Run off the turn's critical path. Codex ignores this handler's output when set. */
  async?: boolean;
  /** Shown in the TUI while the hook runs. */
  statusMessage?: string;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/**
 * Codex parses this file with `#[serde(deny_unknown_fields)]` and permits exactly two
 * top-level keys: `description` and `hooks` (codex-rs/config/src/hook_config.rs).
 *
 * So the shape is closed here too. An earlier version carried a `[key: string]: unknown`
 * index signature and spread it forward in the name of preserving foreign content — but
 * forwarding an unrecognized key produces a file Codex refuses to parse, which drops
 * every hook in it, including the user's own. Preserving a key that breaks the file is
 * not preservation.
 */
export interface HooksFile {
  description?: string;
  hooks?: Record<string, HookMatcherGroup[]>;
}

/** Top-level keys Codex accepts. Anything else makes the whole file unparseable. */
export const ALLOWED_TOP_LEVEL_KEYS = ["description", "hooks"] as const;

/** Keys present in a file that Codex would reject. Callers surface these to the user. */
export function unsupportedTopLevelKeys(file: object | null): string[] {
  if (!file) return [];
  const allowed = new Set<string>(ALLOWED_TOP_LEVEL_KEYS);
  return Object.keys(file).filter((key) => !allowed.has(key));
}

/**
 * SessionStart matchers are compared as an exact alternation list, not a regex
 * (codex-rs/hooks/src/events/common.rs). Every source must be spelled out; omitting
 * `compact` means the session context is never re-injected after a compaction, which is
 * exactly when the model has just lost it. `fork` arrived with Codex 0.155 — a forked
 * thread needs the same rehydration as a resumed one. On older Codex the extra
 * alternative is simply never matched; it does not invalidate the matcher.
 */
export const SESSION_START_MATCHER = "startup|resume|clear|compact|fork";

function isOwned(group: HookMatcherGroup): boolean {
  return group.hooks?.some((hook) => typeof hook.command === "string" && hook.command.includes(GOAT_HOOK_MARKER)) ?? false;
}

/** Ownership test shared with the trust report, which must key exactly the groups goat wrote. */
export const isGoatHookGroup = isOwned;

/**
 * Every hook declares a timeout, because Codex's default for an omitted one is 600
 * seconds (`timeout_sec.unwrap_or(600)`, codex-rs/hooks/src/engine/discovery.rs). A goat
 * hook that hung would have held the turn for ten minutes. Ten seconds is generous for
 * what these do — local file reads, and one `git status` that already caps itself at five
 * — and a timed-out hook only loses its injected context, it never fails the turn.
 */
const SYNCHRONOUS_HOOK_TIMEOUT_SEC = 10;

export function goatHookGroup(command: string, event: GoatHookEvent): HookMatcherGroup {
  const hook: HookCommand = { type: "command", command, timeout: SYNCHRONOUS_HOOK_TIMEOUT_SEC };
  if (event === "Stop") {
    // Stop runs after the model's last message; give it room to persist memory. It only
    // records an observation and never emits a decision, so nothing waits on its output:
    // `async` takes it off the turn's critical path entirely.
    hook.timeout = 15;
    hook.async = true;
  }
  if (event === "SessionStart") hook.statusMessage = "codex-goat: loading workflow state";
  const group: HookMatcherGroup = { hooks: [hook] };
  if (event === "SessionStart") group.matcher = SESSION_START_MATCHER;
  return group;
}

/**
 * Which goat hook definitions this install would change, out of those already present.
 *
 * Codex hashes the NORMALIZED handler — command, matcher, timeout, async, statusMessage —
 * and stores that hash when the user approves it (`hook_hash`,
 * codex-rs/hooks/src/engine/discovery.rs). Change any of those fields and the stored hash
 * no longer matches, the handler becomes `Modified`, and Codex drops it silently: only
 * `Trusted` and `Managed` handlers ever run. So an upgrade that edits a hook definition
 * disables goat on every machine that had already approved it, with nothing said.
 *
 * This compares shapes rather than recomputing the hash. The hash is sha256 over canonical
 * TOML of a serde identity; a second implementation here would drift from Codex's and the
 * drift would be invisible. Shape inequality is the signal that matters: if the definition
 * changed at all, the stored approval is stale.
 */
export function changedGoatHooks(existing: HooksFile | null, next: HooksFile): GoatHookEvent[] {
  return GOAT_HOOK_EVENTS.filter((event) => {
    const before = (existing?.hooks?.[event] ?? []).find(isGoatHookGroup);
    if (!before) return false; // newly registered: the user has not approved anything yet
    const after = (next.hooks?.[event] ?? []).find(isGoatHookGroup);
    return JSON.stringify(before) !== JSON.stringify(after);
  });
}

export function installHooks(existing: HooksFile | null, command: string): HooksFile {
  // Copy only the keys Codex accepts. An unknown key is dropped rather than forwarded;
  // `unsupportedTopLevelKeys` lets the caller tell the user what was removed and why.
  const next: HooksFile = {};
  if (existing?.description !== undefined) next.description = existing.description;
  const hooks: Record<string, HookMatcherGroup[]> = { ...(existing?.hooks ?? {}) };

  for (const event of GOAT_HOOK_EVENTS) {
    const foreign = (hooks[event] ?? []).filter((group) => !isOwned(group));
    hooks[event] = [...foreign, goatHookGroup(command, event)];
  }

  next.hooks = hooks;
  return next;
}

export function uninstallHooks(existing: HooksFile | null): HooksFile | null {
  if (!existing?.hooks) return existing;

  const hooks: Record<string, HookMatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(existing.hooks)) {
    const foreign = groups.filter((group) => !isOwned(group));
    if (foreign.length > 0) hooks[event] = foreign;
  }

  const next: HooksFile = {};
  if (existing.description !== undefined) next.description = existing.description;

  if (Object.keys(hooks).length === 0) {
    // Nothing but goat entries were in the file: signal the caller may delete it.
    return next.description === undefined ? null : next;
  }
  next.hooks = hooks;
  return next;
}
