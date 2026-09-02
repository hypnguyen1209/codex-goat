#!/usr/bin/env node
/**
 * The single entry point Codex invokes for every codex-goat lifecycle hook.
 *
 * Fast path: if the optional Rust helper (`goat-runtime`) was built, hand the payload to
 * it — it starts in a few milliseconds instead of Node's ~40ms+. Otherwise fall back to
 * the TypeScript handler in `dist/`.
 *
 * Contract, in both paths:
 *   - stdin  : one JSON hook payload (snake_case keys, per Codex's hook schema)
 *   - stdout : one JSON hook response (camelCase keys), or `{}`
 *   - exit   : always 0. A hook must never be able to break the user's session.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function nativeBinary() {
  const exe = process.platform === "win32" ? "goat-runtime.exe" : "goat-runtime";
  const candidates = [
    process.env.GOAT_RUNTIME_BIN,
    join(packageRoot, "bin", exe),
    join(packageRoot, "target", "release", exe),
    join(packageRoot, "target", "debug", exe),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function main() {
  const raw = readStdin();
  if (raw.trim().length === 0) {
    process.stdout.write("{}");
    return;
  }

  const native = process.env.GOAT_DISABLE_NATIVE === "1" ? null : nativeBinary();
  if (native) {
    const result = spawnSync(native, ["hook"], {
      input: raw,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().length > 0) {
      process.stdout.write(result.stdout);
      return;
    }
    // Native path failed: fall through to Node rather than dropping the hook.
  }

  try {
    const handler = await import(new URL("../dist/hooks/handler.js", import.meta.url).href);
    process.stdout.write(handler.runHookFromStdin(raw));
  } catch {
    process.stdout.write("{}");
  }
}

main().catch(() => {
  process.stdout.write("{}");
});
