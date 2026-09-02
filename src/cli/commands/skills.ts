import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { color, log } from "../../core/log.js";
import { bundledDir } from "../../core/paths.js";
import { STAGE_IDS, STAGES } from "../../state/stages.js";
import type { ParsedArgs } from "../args.js";

export function runSkills(parsed: ParsedArgs): number {
  if (parsed.flags.has("roles")) return listRoles();

  log.out(color.bold("canonical stages — each invocable on its own, in any order"));
  for (const id of STAGE_IDS) {
    const spec = STAGES[id];
    log.out(`  ${spec.invocation.padEnd(14)} ${spec.summary}`);
    log.detail(`requires: ${spec.requires.length > 0 ? spec.requires.join(", ") : "nothing"}`);
    log.detail(`produces: ${spec.produces}`);
  }

  const bundled = listBundledSkills();
  const extras = bundled.filter((skill) => !(STAGE_IDS as readonly string[]).includes(skill.name));
  if (extras.length > 0) {
    log.out("");
    log.out(color.bold("supporting skills"));
    for (const skill of extras) log.out(`  ${`$${skill.name}`.padEnd(14)} ${skill.description}`);
  }
  return 0;
}

function listRoles(): number {
  const dir = bundledDir("prompts");
  if (!existsSync(dir)) {
    log.warn(`no role prompts bundled at ${dir}`);
    return 1;
  }
  log.out(color.bold("role prompts (goat exec --role <name>)"));
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    log.out(`  ${name.padEnd(20)} ${firstHeading(join(dir, file))}`);
  }
  return 0;
}

export interface BundledSkill {
  name: string;
  description: string;
}

export function listBundledSkills(): BundledSkill[] {
  const dir = bundledDir("skills");
  if (!existsSync(dir)) return [];
  const out: BundledSkill[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    out.push({ name, description: parseFrontmatterDescription(readFileSync(file, "utf8")) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Minimal YAML frontmatter reader — only `name` and `description` matter to Codex. */
export function parseFrontmatterDescription(contents: string): string {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return "";
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^description:\s*(.*)$/);
    if (field?.[1]) return field[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function firstHeading(file: string): string {
  try {
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith("# "));
    return line ? line.slice(2).trim() : "";
  } catch {
    return "";
  }
}
