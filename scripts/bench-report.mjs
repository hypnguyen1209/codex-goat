#!/usr/bin/env node
/**
 * Aggregate every bench/results-<effort>.json into the tables and chart the README uses.
 *
 * Reads only what `codex exec --json` reported; it never re-runs a model. Regenerate with:
 *   node scripts/bench-report.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchDir = join(root, "bench");
const EFFORTS = ["low", "medium", "high"];
const MODELS = ["gpt-5.6-sol", "gpt-5.6-luna"];

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

const load = (effort) => {
  const file = join(benchDir, `results-${effort}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf8"));
  return { ...data, samples: data.samples.filter((s) => !s.error) };
};

const cells = new Map();
let codexVersion = "unknown";
let totalSamples = 0;

for (const effort of EFFORTS) {
  const data = load(effort);
  if (!data) continue;
  codexVersion = data.codexVersion ?? codexVersion;
  for (const model of MODELS) {
    const samples = data.samples.filter((s) => s.model === model);
    if (samples.length === 0) continue;
    totalSamples += samples.length;
    const out = samples.map((s) => s.usage.output_tokens + s.usage.reasoning_output_tokens);
    cells.set(`${effort}|${model}`, {
      n: samples.length,
      out: median(out),
      min: Math.min(...out),
      max: Math.max(...out),
      seconds: Math.round(median(samples.map((s) => s.elapsedMs)) / 100) / 10,
      byPrompt: Object.fromEntries(
        [...new Set(samples.map((s) => s.prompt))].map((p) => [
          p,
          median(
            samples.filter((s) => s.prompt === p).map((s) => s.usage.output_tokens + s.usage.reasoning_output_tokens),
          ),
        ]),
      ),
    });
  }
}

// --- effort table -----------------------------------------------------------
const effortRows = [
  "| Effort | `gpt-5.6-sol` | `gpt-5.6-luna` | vs low (sol) |",
  "| --- | --: | --: | --: |",
];
const solLow = cells.get("low|gpt-5.6-sol")?.out ?? 0;
for (const effort of EFFORTS) {
  const sol = cells.get(`${effort}|gpt-5.6-sol`);
  const luna = cells.get(`${effort}|gpt-5.6-luna`);
  if (!sol || !luna) continue;
  const factor = solLow ? `${(sol.out / solLow).toFixed(2)}×` : "—";
  effortRows.push(`| \`${effort}\` | ${sol.out.toLocaleString()} | ${luna.out.toLocaleString()} | ${factor} |`);
}

// --- per-task table at medium ----------------------------------------------
const sol = cells.get("medium|gpt-5.6-sol");
const luna = cells.get("medium|gpt-5.6-luna");
const taskRows = ["| Task | sol | luna | difference |", "| --- | --: | --: | --: |"];
if (sol && luna) {
  const tasks = Object.keys(sol.byPrompt).sort(
    (a, b) => (luna.byPrompt[a] - sol.byPrompt[a]) / sol.byPrompt[a] - (luna.byPrompt[b] - sol.byPrompt[b]) / sol.byPrompt[b],
  );
  for (const task of tasks) {
    const a = sol.byPrompt[task];
    const b = luna.byPrompt[task];
    const pct = Math.round(((b - a) / a) * 100);
    taskRows.push(`| \`${task}\` | ${a.toLocaleString()} | ${b.toLocaleString()} | ${pct > 0 ? "+" : ""}${pct}% |`);
  }
}

// --- chart ------------------------------------------------------------------
const W = 720;
const H = 300;
const pad = { top: 34, right: 16, bottom: 46, left: 56 };
const plotW = W - pad.left - pad.right;
const plotH = H - pad.top - pad.bottom;
const maxOut = Math.max(...[...cells.values()].map((c) => c.out)) * 1.15;
const groupW = plotW / EFFORTS.length;
const barW = Math.min(64, (groupW - 28) / 2);
const COLORS = { "gpt-5.6-sol": "#8250df", "gpt-5.6-luna": "#1a7f37" };

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif" role="img" aria-label="Median output plus reasoning tokens per turn by reasoning effort. Rising sharply with effort for both models, while the two models stay close at every level.">`,
  `<rect width="${W}" height="${H}" fill="none"/>`,
  `<text x="${pad.left}" y="20" font-size="13" font-weight="600" fill="#1f2328">Median output + reasoning tokens per turn</text>`,
];

for (let i = 0; i <= 4; i += 1) {
  const value = Math.round((maxOut / 4) * i);
  const y = pad.top + plotH - (value / maxOut) * plotH;
  svg.push(`<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#d1d9e0" stroke-width="1"/>`);
  svg.push(`<text x="${pad.left - 8}" y="${y + 4}" font-size="11" fill="#59636e" text-anchor="end">${value}</text>`);
}

EFFORTS.forEach((effort, gi) => {
  const gx = pad.left + gi * groupW;
  MODELS.forEach((model, mi) => {
    const cell = cells.get(`${effort}|${model}`);
    if (!cell) return;
    const h = (cell.out / maxOut) * plotH;
    const x = gx + groupW / 2 - barW - 6 + mi * (barW + 12);
    const y = pad.top + plotH - h;
    svg.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${COLORS[model]}"/>`);
    svg.push(
      `<text x="${x + barW / 2}" y="${y - 6}" font-size="11" font-weight="600" fill="#1f2328" text-anchor="middle">${cell.out}</text>`,
    );
  });
  svg.push(
    `<text x="${gx + groupW / 2}" y="${pad.top + plotH + 20}" font-size="12" fill="#1f2328" text-anchor="middle">${effort}</text>`,
  );
});

svg.push(
  `<text x="${pad.left + plotW / 2}" y="${H - 8}" font-size="11" fill="#59636e" text-anchor="middle">reasoning effort</text>`,
);
MODELS.forEach((model, i) => {
  const x = W - pad.right - 210 + i * 108;
  svg.push(`<rect x="${x}" y="10" width="10" height="10" rx="2" fill="${COLORS[model]}"/>`);
  svg.push(`<text x="${x + 15}" y="19" font-size="11" fill="#1f2328">${model.replace("gpt-", "")}</text>`);
});
svg.push("</svg>");

writeFileSync(join(benchDir, "chart-effort.svg"), `${svg.join("\n")}\n`);

console.log("### Effort table\n");
console.log(effortRows.join("\n"));
console.log("\n### Per-task at medium\n");
console.log(taskRows.join("\n"));
console.log(`\nsamples: ${totalSamples} | codex: ${codexVersion}`);
console.log(`chart:   bench/chart-effort.svg`);
