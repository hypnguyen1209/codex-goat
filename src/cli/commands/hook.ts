import { readFileSync } from "node:fs";
import { runHookFromStdin } from "../../hooks/handler.js";

/**
 * `goat hook` reads one hook payload from stdin and writes the response to stdout.
 *
 * Failure policy: always exit 0, always emit valid JSON. Codex must never lose a session
 * because a helper hook misbehaved.
 */
export function runHook(): number {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  process.stdout.write(raw.trim().length === 0 ? "{}" : runHookFromStdin(raw));
  return 0;
}
