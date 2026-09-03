#!/usr/bin/env node
/**
 * Measure per-turn token usage across Codex models on a fixed prompt set.
 *
 * Every number comes from Codex itself: `codex exec --json` ends a turn with a
 * `turn.completed` event carrying `usage`, so nothing here estimates or tokenizes.
 *
 * Runs are sequential on purpose. Parallel runs would contend for the same rate limit
 * and make wall-clock timings meaningless.
 *
 * Usage:
 *   node scripts/bench-models.mjs --runs 2 --effort medium
 *   node scripts/bench-models.mjs --models gpt-5.6-sol --runs 1   # cheap smoke
 *
 * Results are written to bench/results-<effort>.json and rendered by --render.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "bench");

/**
 * Read-only questions with no repository dependency, so the same prompt means the same
 * thing on any machine and no run can mutate a working tree.
 */
const PROMPTS = [
  {
    id: "react-rerender",
    category: "debugging",
    prompt:
      "Why is a React component re-rendering on every state update even though its props look unchanged, when an object literal is passed as a prop? Explain the cause and the fix.",
  },
  {
    id: "jwt-expiry",
    category: "bugfix",
    prompt:
      "An Express auth middleware lets expired JWTs through. The check compares Date.now() to the token's exp field. What is wrong and how should it be fixed?",
  },
  {
    id: "flaky-test",
    category: "diagnosis",
    prompt:
      "A test passes locally but fails roughly one run in ten in CI. Describe how you would find the cause, in order, and what you would rule out first.",
  },
  {
    id: "sql-index",
    category: "performance",
    prompt:
      "A Postgres query filtering on (tenant_id, created_at) and ordering by created_at DESC is slow at 10M rows. What index would you add and why does column order matter?",
  },
  {
    id: "api-versioning",
    category: "design",
    prompt:
      "Compare URL-path versioning against header-based versioning for a public REST API. Give the trade-off that actually decides it in practice.",
  },
];

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

const args = parseArgs(process.argv.slice(2));
const models = String(args.get("models") ?? "gpt-5.6-sol,gpt-5.6-luna").split(",");
const runs = Number.parseInt(String(args.get("runs") ?? "2"), 10);
const effort = String(args.get("effort") ?? "medium");
const resultsFile = () => join(outDir, `results-${label}-${effort}.json`);

// `--only <id>` runs a single prompt, so the harness can be smoke-tested for a couple of
// calls instead of a full matrix.
// The directory codex runs in. This is what selects baseline vs codex-goat: a project
// with AGENTS.md, .agents/skills and .codex/hooks.json costs more prefix than one without.
const projectDir = typeof args.get("project") === "string" ? String(args.get("project")) : outDir;
const label = typeof args.get("label") === "string" ? String(args.get("label")) : "default";
// codex exec has no hook-trust prompt, so goat's SessionStart injection is inert there
// unless trust is bypassed. Without this the "with codex-goat" arm measures only the
// AGENTS.md block and the skill catalog, not the hook.
const bypassHookTrust = args.has("bypass-hook-trust");

const only = typeof args.get("only") === "string" ? String(args.get("only")) : null;
const selected = only ? PROMPTS.filter((p) => p.id === only) : PROMPTS;
if (selected.length === 0) {
  console.error(`no prompt with id '${only}'. Known: ${PROMPTS.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

/** One `codex exec` turn. Returns Codex's own usage record, or an error. */
function runOnce(model, prompt) {
  const started = Date.now();
  const result = spawnSync(
    "codex",
    [
      "exec",
      "--json",
      // Without --ephemeral, a run inherits session history and memories from the
      // previous one: input_tokens went bimodal across 25k/51k/94k for identical
      // prompts, a 3.8x spread that measured the environment rather than the model.
      // With it, repeated runs land within ~4 tokens of each other.
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      ...(bypassHookTrust ? ["--dangerously-bypass-hook-trust"] : []),
      "-C",
      projectDir,
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${effort}"`,
      prompt,
    ],
    { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const elapsedMs = Date.now() - started;

  if (result.status !== 0) {
    // Report what actually went wrong. An earlier version collapsed every failure to
    // "spawn failed", which hid a Windows sandbox-helper error behind a useless string.
    const detail = [
      result.error ? `${result.error.code ?? "error"}: ${result.error.message}` : null,
      result.signal ? `signal ${result.signal}` : null,
      `status ${result.status}`,
      (result.stderr ?? "").trim() || null,
      (result.stdout ?? "").trim().slice(0, 200) || null,
    ]
      .filter(Boolean)
      .join(" | ");
    return { error: detail.slice(0, 400), elapsedMs };
  }

  let usage = null;
  let text = "";
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "turn.completed" && event.usage) usage = event.usage;
    if (event.type === "item.completed" && event.item?.type === "agent_message") text = event.item.text ?? "";
  }
  if (!usage) return { error: "no turn.completed usage event", elapsedMs };
  return { usage, elapsedMs, replyChars: text.length };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function render(data) {
  const rows = [];
  for (const model of data.models) {
    const samples = data.samples.filter((s) => s.model === model && !s.error);
    if (samples.length === 0) continue;
    rows.push({
      model,
      n: samples.length,
      input: median(samples.map((s) => s.usage.input_tokens)),
      cached: median(samples.map((s) => s.usage.cached_input_tokens)),
      output: median(samples.map((s) => s.usage.output_tokens)),
      reasoning: median(samples.map((s) => s.usage.reasoning_output_tokens)),
      seconds: Math.round(median(samples.map((s) => s.elapsedMs)) / 100) / 10,
    });
  }

  const lines = [
    `| Model | n | input | cached | output | reasoning | total out | s/turn |`,
    `| --- | --: | --: | --: | --: | --: | --: | --: |`,
  ];
  for (const r of rows) {
    lines.push(
      `| \`${r.model}\` | ${r.n} | ${r.input.toLocaleString()} | ${r.cached.toLocaleString()} | ${r.output.toLocaleString()} | ${r.reasoning.toLocaleString()} | ${(r.output + r.reasoning).toLocaleString()} | ${r.seconds} |`,
    );
  }
  return { rows, table: lines.join("\n") };
}

if (args.has("render")) {
  const data = JSON.parse(readFileSync(resultsFile(), "utf8"));
  console.log(render(data).table);
  process.exit(0);
}

/**
 * Measure the always-on prefix: everything Codex sends before your prompt — system
 * instructions, tool schemas, AGENTS.md, the skill catalog.
 *
 * This needs a prompt trivial enough to finish in ONE model call. `input_tokens` is summed
 * across every request in a turn, so a question that makes the model think twice reports
 * roughly double the prefix — which is what made the task benchmark's input column
 * bimodal at 26k/52k and useless as a model property.
 */
if (args.has("prefix")) {
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const model of models) {
    const inputs = [];
    for (let run = 0; run < runs; run += 1) {
      const outcome = runOnce(model, "Reply with exactly: OK");
      if (outcome.error) {
        console.error(`  ${model}: ${outcome.error}`);
        continue;
      }
      inputs.push(outcome.usage.input_tokens);
    }
    if (inputs.length > 0) {
      rows.push({ model, n: inputs.length, min: Math.min(...inputs), max: Math.max(...inputs), med: median(inputs) });
    }
  }
  console.log(`| Model | n | prefix tokens | spread |`);
  console.log(`| --- | --: | --: | --: |`);
  for (const r of rows) {
    console.log(`| \`${r.model}\` | ${r.n} | ${r.med.toLocaleString()} | ±${r.max - r.min} |`);
  }
  writeFileSync(join(outDir, `results-prefix-${label}.json`), `${JSON.stringify({ effort, rows }, null, 2)}\n`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const samples = [];
const total = models.length * selected.length * runs;
let done = 0;

for (const model of models) {
  for (const prompt of selected) {
    for (let run = 1; run <= runs; run += 1) {
      done += 1;
      process.stderr.write(`[${done}/${total}] ${model} ${prompt.id} run${run} ... `);
      // One retry: the Windows sandbox helper fails intermittently under rapid repeated
      // invocation, and a single flake would otherwise void the whole matrix.
      let outcome = runOnce(model, prompt.prompt);
      if (outcome.error) {
        process.stderr.write("retry ... ");
        spawnSync(process.execPath, ["-e", "setTimeout(()=>{},3000)"]);
        outcome = runOnce(model, prompt.prompt);
      }
      if (outcome.error) {
        process.stderr.write(`ERROR ${outcome.error}\n`);
        samples.push({ model, prompt: prompt.id, category: prompt.category, run, error: outcome.error });
        continue;
      }
      const { usage, elapsedMs, replyChars } = outcome;
      process.stderr.write(
        `in ${usage.input_tokens} out ${usage.output_tokens} reasoning ${usage.reasoning_output_tokens} (${Math.round(elapsedMs / 1000)}s)\n`,
      );
      samples.push({ model, prompt: prompt.id, category: prompt.category, run, usage, elapsedMs, replyChars });
    }
  }
}

const data = {
  // No timestamp: it would churn the file on every run and say nothing useful.
  codexVersion: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "unknown",
  effort,
  label,
  projectDir,
  bypassHookTrust,
  runs,
  models,
  promptCount: selected.length,
  samples,
};
writeFileSync(resultsFile(), `${JSON.stringify(data, null, 2)}\n`);

const { table } = render(data);
console.log(`\n${table}`);
console.error(`\nwrote ${resultsFile}`);
