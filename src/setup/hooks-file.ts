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

export interface HooksFile {
  hooks?: Record<string, HookMatcherGroup[]>;
  [key: string]: unknown;
}

function isOwned(group: HookMatcherGroup): boolean {
  return group.hooks?.some((hook) => typeof hook.command === "string" && hook.command.includes(GOAT_HOOK_MARKER)) ?? false;
}

export function goatHookGroup(command: string, event: GoatHookEvent): HookMatcherGroup {
  const hook: HookCommand = { type: "command", command };
  // Stop runs after the model's last message; give it room to persist memory.
  if (event === "Stop") hook.timeout = 15;
  const group: HookMatcherGroup = { hooks: [hook] };
  if (event === "SessionStart") group.matcher = "startup|resume|clear";
  return group;
}

export function installHooks(existing: HooksFile | null, command: string): HooksFile {
  const next: HooksFile = existing ? { ...existing } : {};
  const hooks: Record<string, HookMatcherGroup[]> = { ...(next.hooks ?? {}) };

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

  const next: HooksFile = { ...existing };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
    // Nothing but goat entries were in the file: signal the caller may delete it.
    return Object.keys(next).length === 0 ? null : next;
  }
  next.hooks = hooks;
  return next;
}
