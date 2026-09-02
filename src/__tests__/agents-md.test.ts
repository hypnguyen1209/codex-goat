import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENTS_END, AGENTS_START, hasAgentsSection, mergeAgentsSection, stripAgentsSection } from "../setup/agents-md.js";

test("creates the section when no file exists", () => {
  const merged = mergeAgentsSection(null, "rules");
  assert.ok(merged.startsWith(AGENTS_START));
  assert.ok(merged.includes("rules"));
  assert.ok(hasAgentsSection(merged));
});

test("appends without touching existing content", () => {
  const existing = "# My project\n\nDo not force-push.\n";
  const merged = mergeAgentsSection(existing, "goat rules");
  assert.ok(merged.startsWith(existing), "user content was modified");
  assert.ok(merged.includes("goat rules"));
});

test("replaces only the marked section on refresh", () => {
  const first = mergeAgentsSection("# Mine\n\nkeep me\n", "v1 rules");
  const second = mergeAgentsSection(first, "v2 rules");
  assert.ok(second.includes("keep me"));
  assert.ok(second.includes("v2 rules"));
  assert.ok(!second.includes("v1 rules"));
  assert.equal(second.split(AGENTS_START).length - 1, 1, "duplicate section inserted");
});

test("content after the section survives a refresh", () => {
  const original = `before\n${AGENTS_START}\nold\n${AGENTS_END}\nafter\n`;
  const merged = mergeAgentsSection(original, "new");
  assert.ok(merged.includes("before"));
  assert.ok(merged.includes("after"));
  assert.ok(merged.includes("new"));
  assert.ok(!merged.includes("old"));
});

test("strip removes the section and leaves the rest", () => {
  const merged = mergeAgentsSection("# Mine\n\nkeep me\n", "goat rules");
  const stripped = stripAgentsSection(merged);
  assert.ok(stripped.includes("keep me"));
  assert.ok(!stripped.includes("goat rules"));
  assert.ok(!hasAgentsSection(stripped));
});

test("strip is a no-op when the section is absent", () => {
  assert.equal(stripAgentsSection("plain content\n"), "plain content\n");
});

test("a truncated marker pair is treated as absent, not merged into", () => {
  const broken = `text\n${AGENTS_START}\nunterminated\n`;
  const merged = mergeAgentsSection(broken, "rules");
  assert.ok(merged.includes("unterminated"), "pre-existing content was dropped");
  assert.ok(merged.includes("rules"));
});
