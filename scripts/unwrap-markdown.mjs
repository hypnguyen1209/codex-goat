#!/usr/bin/env node
/**
 * Join hard-wrapped prose so each paragraph is one long line.
 *
 * Markdown renders a wrapped paragraph and an unwrapped one identically, so this is
 * purely a source-format choice — it makes prose diffs word-level instead of
 * reflow-shaped. Everything whose meaning depends on line breaks is left byte-for-byte:
 * fenced code, tables, headings, HTML blocks, link-reference definitions, and the
 * boundaries between list items.
 *
 * Usage: node scripts/unwrap-markdown.mjs <file...> [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const TABLE_ROW = /^\s*\|/;
const HTML_LINE = /^\s*<\/?[a-zA-Z!]/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const BLOCKQUOTE = /^\s*>/;
const LINK_DEF = /^\s*\[[^\]]+\]:\s/;
const INDENTED_CODE = /^ {4,}\S/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** A line that must keep its own line, whatever surrounds it. */
function isStandalone(line) {
  return (
    HEADING.test(line) ||
    TABLE_ROW.test(line) ||
    HTML_LINE.test(line) ||
    LINK_DEF.test(line) ||
    THEMATIC_BREAK.test(line) ||
    INDENTED_CODE.test(line) ||
    line.trim().length === 0
  );
}

export function unwrapMarkdown(source) {
  const lines = source.split("\n");
  const out = [];
  let buffer = null;
  let fence = null;

  const flush = () => {
    if (buffer !== null) {
      out.push(buffer);
      buffer = null;
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      flush();
      // Track the exact marker so a ``` inside a ~~~ block does not close it.
      fence = fence === null ? fenceMatch[1] : fence === fenceMatch[1] ? null : fence;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }

    if (isStandalone(line)) {
      flush();
      out.push(line);
      continue;
    }

    // A new list item or blockquote starts a new logical line; its continuation lines
    // fold into it, so nesting and markers survive but the wrapping does not.
    const listMatch = line.match(LIST_ITEM);
    if (listMatch || BLOCKQUOTE.test(line)) {
      flush();
      buffer = line.trimEnd();
      continue;
    }

    buffer = buffer === null ? line.trimEnd() : `${buffer} ${line.trim()}`;
  }

  flush();
  return out.join("\n");
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const files = args.filter((arg) => !arg.startsWith("--"));
let changed = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = unwrapMarkdown(before);
  if (before === after) continue;
  changed += 1;
  if (check) {
    console.error(`would rewrite ${file}`);
  } else {
    writeFileSync(file, after, "utf8");
    console.log(`unwrapped ${file}`);
  }
}

if (check && changed > 0) process.exit(1);
