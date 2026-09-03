#!/usr/bin/env node
/**
 * Print the real cross-layer import graph of src/, derived from the source rather than
 * from memory. Used to keep the architecture diagram in README.md honest.
 *
 * Usage: node scripts/module-graph.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walk(full);
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
})("src");

const posix = (p) => p.split(sep).join("/");

/** Everything under src/<layer>/ belongs to <layer>; loose files are "(root)". */
function layerOf(file) {
  const rel = posix(file).replace(/^.*?src\//, "");
  const parts = rel.split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}

const perLayer = new Map();
const edges = new Map();

for (const file of files) {
  const from = layerOf(file);
  perLayer.set(from, (perLayer.get(from) ?? 0) + 1);

  for (const match of readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const to = layerOf(posix(normalize(join(dirname(file), spec))));
    if (to === from) continue;
    const key = `${from} -> ${to}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}

console.log("files per layer:");
for (const [layer, count] of [...perLayer].sort()) console.log(`  ${layer.padEnd(10)} ${count}`);

console.log("\ncross-layer imports:");
for (const [edge, count] of [...edges].sort()) console.log(`  ${edge}  x${count}`);

// A layer that imports something importing it back is the shape worth knowing about.
const cycles = [...edges.keys()].filter((edge) => {
  const [from, to] = edge.split(" -> ");
  return edges.has(`${to} -> ${from}`);
});
console.log(`\ncycles: ${cycles.length === 0 ? "none" : cycles.join(", ")}`);
