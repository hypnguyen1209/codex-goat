#!/usr/bin/env node
// npm needs the bin entry executable on POSIX. No-op on Windows.
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const file of [join(root, "dist", "cli", "goat.js"), join(root, "hooks", "goat-hook.mjs")]) {
    if (existsSync(file)) chmodSync(file, 0o755);
  }
}
