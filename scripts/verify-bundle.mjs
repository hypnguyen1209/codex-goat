#!/usr/bin/env node
/**
 * Contract test for everything that ships but is not TypeScript.
 *
 * These are the failures unit tests cannot catch: a skill whose frontmatter Codex will
 * reject, a stage with no skill, a role prompt missing from the goat-roles index, or a
 * hook registration pointing at a file that is not in the package.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const checks = [];

function check(name, condition, detail) {
  checks.push(name);
  if (!condition) failures.push(`${name}: ${detail}`);
}

/** Codex requires `name` and `description` in SKILL.md frontmatter, and rejects the file otherwise. */
function parseFrontmatter(contents) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

// --- skills -----------------------------------------------------------------
const skillsDir = join(root, "skills");
const skillNames = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());

check("skills present", skillNames.length > 0, "no skill directories found");

for (const name of skillNames) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    failures.push(`skill ${name}: SKILL.md missing`);
    continue;
  }
  const contents = readFileSync(file, "utf8");
  const front = parseFrontmatter(contents);

  check(`skill ${name} frontmatter`, front !== null, "missing or malformed YAML frontmatter");
  if (!front) continue;

  check(`skill ${name} name`, front.name === name, `frontmatter name '${front.name}' must equal directory '${name}'`);
  check(`skill ${name} description`, Boolean(front.description), "frontmatter description is required");
  check(
    `skill ${name} description length`,
    (front.description ?? "").length >= 40 && (front.description ?? "").length <= 500,
    `description is ${(front.description ?? "").length} chars; aim for 40-500 so Codex can route to it`,
  );
  check(
    `skill ${name} ownership marker`,
    contents.includes("codex-goat"),
    "must mention codex-goat so setup/uninstall can identify ownership",
  );
}

// --- stages have skills -----------------------------------------------------
const stagesSource = readFileSync(join(root, "src", "state", "stages.ts"), "utf8");
const stageBlock = stagesSource.match(/export const STAGE_IDS = \[([\s\S]*?)\] as const;/);
check("stage list parsed", Boolean(stageBlock), "could not read STAGE_IDS from src/state/stages.ts");

if (stageBlock) {
  const stageIds = [...stageBlock[1].matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  check("stage list non-empty", stageIds.length > 0, "STAGE_IDS is empty");
  for (const id of stageIds) {
    check(`stage ${id} has a skill`, skillNames.includes(id), `no skills/${id}/SKILL.md for declared stage`);
  }
}

// --- role prompts -----------------------------------------------------------
const promptsDir = join(root, "prompts");
const promptFiles = readdirSync(promptsDir).filter((name) => name.endsWith(".md"));
check("role prompts present", promptFiles.length > 0, "prompts/ is empty");

const rolesIndex = readFileSync(join(skillsDir, "goat-roles", "SKILL.md"), "utf8");
for (const file of promptFiles) {
  check(
    `role ${file} indexed`,
    rolesIndex.includes(`references/${file}`),
    `not listed in skills/goat-roles/SKILL.md; goat setup would install an undocumented role`,
  );
}

// --- hooks ------------------------------------------------------------------
const hooksFile = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
const hookEvents = Object.keys(hooksFile.hooks ?? {});
for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
  check(`hook ${event} registered`, hookEvents.includes(event), "missing from hooks/hooks.json");
}
check("hook script exists", existsSync(join(root, "hooks", "goat-hook.mjs")), "hooks/goat-hook.mjs is missing");

const hookCommands = Object.values(hooksFile.hooks ?? {})
  .flat()
  .flatMap((group) => group.hooks ?? [])
  .map((hook) => hook.command);
// Codex's own placeholder, substituted by its hook engine. Built by concatenation so it
// cannot be mistaken for — or lint-fixed into — a JavaScript template literal.
const PLUGIN_ROOT_PLACEHOLDER = `\${${"PLUGIN_ROOT"}}`;
check(
  "hook commands use PLUGIN_ROOT",
  hookCommands.every((command) => command.includes(PLUGIN_ROOT_PLACEHOLDER)),
  `plugin hook commands must resolve through ${PLUGIN_ROOT_PLACEHOLDER}`,
);

// --- packaging --------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const entry of ["skills/", "prompts/", "templates/", "hooks/", "dist/"]) {
  check(`package files includes ${entry}`, pkg.files.includes(entry), "would be missing from the published tarball");
}

const plugin = JSON.parse(readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"));
check("plugin version matches package", plugin.version === pkg.version, `${plugin.version} != ${pkg.version}`);

// The compiled-in constant is what a single-file binary reports; drift means `goat
// version` lies for Bun users while staying correct for everyone else.
const compiledVersion = readFileSync(join(root, "src", "version.ts"), "utf8").match(/VERSION = "([^"]+)"/);
check(
  "src/version.ts matches package",
  compiledVersion?.[1] === pkg.version,
  `${compiledVersion?.[1]} != ${pkg.version}`,
);
check("plugin skills path", plugin.skills === "./skills/", `unexpected skills path '${plugin.skills}'`);
check("plugin hooks path", plugin.hooks === "./hooks/hooks.json", `unexpected hooks path '${plugin.hooks}'`);

// --- templates --------------------------------------------------------------
check("AGENTS template exists", existsSync(join(root, "templates", "AGENTS.md")), "templates/AGENTS.md is missing");

// --- invariants that were once only prose ------------------------------------
// v0.1.0 declared a "missing" requirement verdict that nothing produced, which made the
// readiness filter a tautology and hid the never-hard-block rule behind a dead branch.
const contractSource = readFileSync(join(root, "src", "state", "contract.ts"), "utf8");
check(
  "no dead requirement verdict",
  !/RequirementVerdict\s*=[^;]*"missing"/.test(contractSource),
  'RequirementVerdict must stay "satisfied" | "inline" — a third verdict would make a stage hard-blockable',
);

// The evidence gate is the project's central claim. If nothing compares exitCode, a
// failing command counts as proof — which is exactly the bug this check exists to prevent.
const storeSource = readFileSync(join(root, "src", "state", "store.ts"), "utf8");
// Scoped to the predicate's own body: `exitCode !== 0` also appears in unprovenReason, so
// searching the whole file would keep passing after the gate itself stopped checking.
const substantiveBody = storeSource.match(
  /export function isSubstantiveEvidence\([^)]*\)[^{]*\{([\s\S]*?)\n\}/,
);
check(
  "evidence gate inspects the exit code",
  Boolean(substantiveBody) && /exitCode\s*!==\s*0/.test(substantiveBody[1]),
  "isSubstantiveEvidence must itself reject a non-zero exit code",
);

// The native hook path renders the same verdicts; if the two lists diverge, a resumed
// session and `goat status` disagree about which claims are proven.
const rustHook = readFileSync(join(root, "crates", "goat-runtime", "src", "hook.rs"), "utf8");
const noOpList = (source) => {
  const match = source.match(/NO_OP_COMMANDS[^=]*=\s*(?:new Set\()?[&]?\[([^\]]*)\]/);
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).sort() : null;
};
const tsNoOps = noOpList(storeSource);
const rustNoOps = noOpList(rustHook);
check(
  "no-op command lists agree across the Node and native hook paths",
  tsNoOps !== null && rustNoOps !== null && JSON.stringify(tsNoOps) === JSON.stringify(rustNoOps),
  `store.ts=${JSON.stringify(tsNoOps)} vs hook.rs=${JSON.stringify(rustNoOps)}`,
);

// --- report -----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`bundle contract: ${failures.length} failure(s) of ${checks.length} checks\n`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log(`bundle contract: ${checks.length} checks passed`);
