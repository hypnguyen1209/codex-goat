import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoatError, log } from "../../core/log.js";
import { bundledDir } from "../../core/paths.js";
import { runInherit } from "../../core/proc.js";
import type { ParsedArgs } from "../args.js";
import { flagString } from "../args.js";
import { codexBinary } from "../launch.js";

/**
 * `goat exec` is the real smoke test: it forces Codex to authenticate and complete a
 * model call. `goat doctor` cannot do that, so the two are kept separate on purpose.
 *
 * `--role <name>` prepends a role card from `prompts/`, which is also how a shell script
 * can borrow one of goat's specialist prompts without going through a skill.
 */
export async function runExec(parsed: ParsedArgs): Promise<number> {
  const prompt = parsed.positionals.join(" ").trim();
  if (!prompt) {
    throw new GoatError("No prompt supplied.", 'Usage: goat exec "Reply with exactly GOAT-OK"');
  }

  const role = flagString(parsed.flags, "role");
  const composed = role ? `${loadRole(role)}\n\n---\n\n${prompt}` : prompt;

  const args = ["exec", "--skip-git-repo-check", "-C", process.cwd()];
  const effort = flagString(parsed.flags, "effort");
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  args.push(...parsed.passthrough, composed);

  log.detail(`codex exec via ${role ? `role '${role}'` : "no role"}`);
  return runInherit(codexBinary(), args);
}

export function loadRole(role: string): string {
  const safe = role.replace(/[^\w-]/g, "");
  const file = join(bundledDir("prompts"), `${safe}.md`);
  if (!existsSync(file)) {
    throw new GoatError(`Unknown role '${role}'.`, "List available roles with `goat skills --roles`.");
  }
  return readFileSync(file, "utf8").trim();
}
