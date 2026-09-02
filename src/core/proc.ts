import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Capture a command's output. Never throws on a non-zero exit; callers inspect `code`. */
export function runCapture(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
    // `shell: false` keeps arguments literal; no command string is ever built by concatenation.
    shell: false,
  });
  return {
    code: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ""),
  };
}

/** Inherit stdio and resolve with the child's exit code. Used to hand the terminal to Codex. */
export function runInherit(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    const forward = (signal: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(signal);
    };
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", () => resolvePromise(127));
    child.on("close", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      resolvePromise(code ?? (signal ? 130 : 1));
    });
  });
}

export function which(command: string): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  return first ? first.trim() : null;
}
