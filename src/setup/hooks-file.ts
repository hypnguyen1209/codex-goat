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
 * (codex-rs/hooks/src/events/common.rs). All four sources must be spelled out; omitting
 * `compact` means the session context is never re-injected after a compaction, which is
 * exactly when the model has just lost it.
 */
export const SESSION_START_MATCHER = "startup|resume|clear|compact";

function isOwned(group: HookMatcherGroup): boolean {
  return group.hooks?.some((hook) => typeof hook.command === "string" && hook.command.includes(GOAT_HOOK_MARKER)) ?? false;
}

export function goatHookGroup(command: string, event: GoatHookEvent): HookMatcherGroup {
  const hook: HookCommand = { type: "command", command };
  // Stop runs after the model's last message; give it room to persist memory.
  if (event === "Stop") hook.timeout = 15;
  const group: HookMatcherGroup = { hooks: [hook] };
  if (event === "SessionStart") group.matcher = SESSION_START_MATCHER;
  return group;
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
