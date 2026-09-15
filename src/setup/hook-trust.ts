import { GOAT_HOOK_EVENTS, type GoatHookEvent, type HooksFile, isGoatHookGroup } from "./hooks-file.js";

/**
 * Registration is not activation. Codex runs a user- or project-layer hook only after the
 * user has trusted it, and records that trust in `config.toml` as
 *
 *   [hooks.state."<hooks.json path>:<event label>:<group index>:<handler index>"]
 *   trusted_hash = "sha256:…"
 *
 * (codex-rs/hooks/src/lib.rs `hook_key`, codex-rs/hooks/src/engine/discovery.rs). An
 * untrusted hook is dropped silently, and `codex exec` never prompts, so goat's hooks can be
 * registered and inert for months with nothing saying so. This module only DETECTS that
 * state. It never writes trust: the hash covers the handler's exact definition and the
 * prompt exists so a user sees what will run — forging it would defeat both.
 */

/** Codex's snake_case labels for the events goat registers (`hook_event_key_label`). */
export const HOOK_EVENT_LABELS: Record<GoatHookEvent, string> = {
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
  Stop: "stop",
};

export interface HookTrust {
  event: GoatHookEvent;
  /** The `[hooks.state."…"]` key Codex uses for this handler. */
  key: string;
  trusted: boolean;
}

/** Path comparison that survives Windows backslashes and TOML's escaping of them. */
function normalizePath(path: string): string {
  return path.replace(/\\\\/g, "\\").replace(/\\/g, "/").toLowerCase();
}

/**
 * The trust keys for every goat-owned handler in a hooks file, computed the way Codex
 * computes them: the file's absolute path, the event label, and the handler's position.
 */
export function goatHookKeys(file: HooksFile | null, hooksPath: string): Array<{ event: GoatHookEvent; key: string }> {
  const out: Array<{ event: GoatHookEvent; key: string }> = [];
  for (const event of GOAT_HOOK_EVENTS) {
    const groups = file?.hooks?.[event] ?? [];
    groups.forEach((group, groupIndex) => {
      if (!isGoatHookGroup(group)) return;
      (group.hooks ?? []).forEach((_hook, handlerIndex) => {
        out.push({ event, key: `${hooksPath}:${HOOK_EVENT_LABELS[event]}:${groupIndex}:${handlerIndex}` });
      });
    });
  }
  return out;
}

/**
 * Every `[hooks.state."…"]` key in a config.toml that carries a `trusted_hash`.
 *
 * A line scan, not a TOML parser: the shape is fixed and goat ships no dependencies. A key
 * whose section has `enabled = false` but a hash is still returned as trusted — disabled is
 * a different question from untrusted, and this module answers only the second.
 */
export function trustedHookKeys(configToml: string): Set<string> {
  const trusted = new Set<string>();
  let current: string | null = null;
  for (const raw of configToml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[hooks\.state\."(.+)"\]$/);
    if (header?.[1]) {
      current = header[1];
      continue;
    }
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    if (current && /^trusted_hash\s*=/.test(line)) trusted.add(normalizePath(current));
  }
  return trusted;
}

/** Which of goat's handlers in `hooksPath` Codex will actually run, per the user's config.toml. */
export function hookTrustReport(file: HooksFile | null, hooksPath: string, configToml: string): HookTrust[] {
  const trusted = trustedHookKeys(configToml);
  return goatHookKeys(file, hooksPath).map(({ event, key }) => ({ event, key, trusted: trusted.has(normalizePath(key)) }));
}
