// Measures what Codex actually puts in the skill catalog, from a real
// `codex debug prompt-input` dump:
//
//   codex debug prompt-input > dump.json && node scripts/catalog-probe.mjs dump.json
//
// Codex divides one fixed character budget across every installed skill, so a
// description is not shipped whole — it is cut to roughly budget/N. A description's
// routing value therefore depends on how many OTHER skills the user has installed,
// which is not something this repo can see from its own files. Run this before
// changing any `description:` line.
import { readFileSync } from "node:fs";

const dump = readFileSync(process.argv[2] ?? "dump.json", "utf8");

// Walk the parsed payload rather than regexing it: the catalog is a JSON string value,
// so its newlines are escaped and a regex over the raw bytes sees one long line.
const texts = [];
const walk = (node) => {
  if (typeof node === "string") texts.push(node);
  else if (Array.isArray(node)) node.forEach(walk);
  else if (node && typeof node === "object") Object.values(node).forEach(walk);
};
try {
  walk(JSON.parse(dump));
} catch {
  // Not JSON (or truncated) — fall back to treating the whole dump as one blob.
  texts.push(dump);
}

const block = texts.find((t) => t.includes("### Available skills"));
if (!block) {
  console.log("no skill catalog in this dump");
  process.exit(0);
}

const lines = block.split("\n").filter((l) => /^-\s.*\(file:/.test(l.trim()));
const describe = (line) =>
  line
    .trim()
    .replace(/^-\s*[^:]+:\s*/, "")
    .replace(/\s*\(file:[^)]*\)\s*$/, "")
    .trim();

const total = lines.reduce((a, l) => a + l.length, 0);
console.log(`catalog: ${lines.length} skills, ${total} chars (avg ${Math.round(total / lines.length)}/line)`);
console.log();

// Match on the file path, never on the description text. "Part of codex-goat." sits at
// the END of every description, so on a truncated catalog it is the first thing cut —
// a filter that looks for it reports the skills as absent when they are merely clipped.
const OURS = /(clarify|code-review|goat-roles|goat-workflow|plan|team|ultragoal|ultraqa)[\/\\]SKILL\.md/;
const ours = lines.filter((l) => OURS.test(l));
if (ours.length === 0) {
  console.log("  no codex-goat skills installed in this environment");
  process.exit(0);
}

let kept = 0;
let withTrigger = 0;
for (const line of ours) {
  const desc = describe(line);
  const name = line.match(/([a-z-]+)(?:\/SKILL\.md)/)?.[1] ?? line.trim().split(":")[0].replace(/^-\s*/, "");
  const trigger = /Use when/.test(desc);
  kept += desc.length;
  if (trigger) withTrigger += 1;
  console.log(
    `  ${name.padEnd(14)}${String(desc.length).padStart(4)} ch  trigger=${trigger ? "YES" : "no "}  ends …${JSON.stringify(desc.slice(-38))}`,
  );
}

console.log();
console.log(`  ${withTrigger}/${ours.length} descriptions still carry their "Use when" trigger clause`);
console.log(`  surviving description text: ${kept} chars ≈ ${Math.round(kept / 4)} tok`);
