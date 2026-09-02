/**
 * A tiny, explicit argv splitter.
 *
 * `goat` owns a small set of flags and forwards everything else to `codex` untouched.
 * Anything after a bare `--` is always forwarded verbatim, so a Codex flag that happens
 * to collide with a goat flag can still be passed through.
 */

export interface ParsedArgs {
  /** First non-flag token, when it names a `goat` subcommand. */
  command: string | null;
  /** Flags goat consumes itself. */
  flags: Map<string, string | true>;
  /** Positional arguments that belong to the goat subcommand. */
  positionals: string[];
  /** Tokens forwarded to `codex` verbatim. */
  passthrough: string[];
  /** The original argv, so launch can forward unknown tokens in their original order. */
  raw: readonly string[];
}

export const GOAT_COMMANDS = new Set([
  "setup",
  "doctor",
  "exec",
  "status",
  "state",
  "contract",
  "ledger",
  "skills",
  "hook",
  "uninstall",
  "help",
  "version",
]);

/** goat flags that take a value as the next token (`--scope project`). */
const VALUE_FLAGS = new Set([
  "artifact",
  "effort",
  "exit",
  "limit",
  "note",
  "objective",
  "role",
  "scope",
  "stage",
  "status",
  "summary",
  "worktree",
]);

/** Short goat flags that take a value (`-w feat/task`). */
const SHORT_VALUE_FLAGS = new Set(["w"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  const passthrough: string[] = [];
  let command: string | null = null;
  let afterSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (afterSeparator) {
      passthrough.push(token);
      continue;
    }
    if (token === "--") {
      afterSeparator = true;
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags.set(body, next);
          index += 1;
          continue;
        }
      }
      flags.set(body, true);
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const name = token.slice(1);
      if (SHORT_VALUE_FLAGS.has(name)) {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags.set(name, next);
          index += 1;
          continue;
        }
      }
      flags.set(name, true);
      continue;
    }

    if (command === null && GOAT_COMMANDS.has(token)) {
      command = token;
      continue;
    }
    positionals.push(token);
  }

  return { command, flags, positionals, passthrough, raw: argv };
}

export function flagString(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" ? value : null;
}

export function flagBool(flags: Map<string, string | true>, ...names: string[]): boolean {
  return names.some((name) => flags.has(name));
}
