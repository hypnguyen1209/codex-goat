#!/usr/bin/env node
// Remove build output before a fresh compile so deleted sources cannot linger in dist/.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
rmSync(join(root, "dist"), { recursive: true, force: true });
