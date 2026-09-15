import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../cli/args.js";
import { buildLaunchPlan } from "../cli/launch.js";

// buildLaunchPlan resolves the codex binary; point it somewhere harmless for these tests.
process.env.GOAT_CODEX_BIN = "codex";
// The version gate on Astra routes reads this instead of spawning `codex --version`.
// 0.154.0 is the newest published CLI at the time of writing and clears every gate.
process.env.GOAT_CODEX_VERSION = "codex-cli 0.154.0";

function planFor(argv: string[]) {
  return buildLaunchPlan(parseArgs(argv), process.cwd());
}

function argsFor(argv: string[]): string[] {
  return planFor(argv).args;
}

function modelOf(argv: string[]): string | undefined {
  const args = argsFor(argv);
  const at = args.indexOf("-m");
  return at === -1 ? undefined : args[at + 1];
}

/** Run `fn` with the version probe pinned to `version` (or unset), then restore it. */
function withCodexVersion<T>(version: string | undefined, fn: () => T): T {
  const previous = process.env.GOAT_CODEX_VERSION;
  if (version === undefined) delete process.env.GOAT_CODEX_VERSION;
  else process.env.GOAT_CODEX_VERSION = version;
  try {
    return fn();
  } finally {
    process.env.GOAT_CODEX_VERSION = previous;
  }
}

const YOLO = ["-c", 'approval_policy="never"', "-c", 'sandbox_mode="danger-full-access"'];

test("injects high reasoning effort and yolo permissions by default", () => {
  assert.deepEqual(argsFor([]), ["-c", 'model_reasoning_effort="high"', ...YOLO]);
});

// goat's job is to let Codex finish work, so no approvals and no sandbox is the default.
// It is injected as the two config overrides Codex's own --yolo sets, so --print-argv
// shows it and anything explicit the user types wins.
test("--safe keeps Codex's own approval and sandbox defaults", () => {
  const plan = planFor(["--safe"]);
  assert.deepEqual(plan.args, ["-c", 'model_reasoning_effort="high"']);
  assert.ok(plan.notes.some((note) => /^safe:/.test(note)));
  assert.ok(!plan.args.includes("--safe"), "--safe leaked into the codex argv");
});

test("an explicit sandbox flag suppresses only the sandbox override", () => {
  for (const argv of [["-s", "read-only"], ["--sandbox", "workspace-write"], ["--sandbox=read-only"], ["-c", "sandbox_mode=read-only"], ["--config=sandbox_mode=read-only"]]) {
    const args = argsFor(argv);
    assert.ok(!args.includes('sandbox_mode="danger-full-access"'), `${argv.join(" ")}: sandbox override still injected`);
    assert.ok(args.includes('approval_policy="never"'), `${argv.join(" ")}: approval override wrongly dropped`);
  }
});

test("an explicit approval flag suppresses only the approval override", () => {
  for (const argv of [["-a", "on-request"], ["--ask-for-approval=untrusted"], ["-c", "approval_policy=on-failure"]]) {
    const args = argsFor(argv);
    assert.ok(!args.includes('approval_policy="never"'), `${argv.join(" ")}: approval override still injected`);
    assert.ok(args.includes('sandbox_mode="danger-full-access"'), `${argv.join(" ")}: sandbox override wrongly dropped`);
  }
});

test("Codex's own combined permission flags suppress both overrides", () => {
  for (const argv of [["--full-auto"], ["--yolo"], ["--dangerously-bypass-approvals-and-sandbox"], ["--madmax"]]) {
    const plan = planFor(argv);
    assert.ok(!plan.args.includes('approval_policy="never"') && !plan.args.includes('sandbox_mode="danger-full-access"'), `${argv[0]}: override injected alongside`);
    assert.ok(plan.notes.some((note) => /keeping your explicit/.test(note)), `${argv[0]}: no note`);
  }
});

test("a permission flag after -- still counts as the user's choice", () => {
  const args = argsFor(["--", "-s", "read-only"]);
  assert.ok(!args.includes('sandbox_mode="danger-full-access"'), "goat overrode a sandbox the user typed after --");
  assert.ok(args.includes('approval_policy="never"'));
  assert.deepEqual(args.slice(-2), ["-s", "read-only"]);
});

test("--no-goat-defaults suppresses the yolo overrides too", () => {
  assert.deepEqual(argsFor(["--no-goat-defaults"]), []);
});

test("--xhigh raises the effort", () => {
  assert.ok(argsFor(["--xhigh"]).includes('model_reasoning_effort="xhigh"'));
});

test("--effort wins over the shorthand flags", () => {
  assert.ok(argsFor(["--xhigh", "--effort", "low"]).includes('model_reasoning_effort="low"'));
});

test("--madmax maps to the codex bypass flag", () => {
  assert.ok(argsFor(["--madmax"]).includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("--no-goat-defaults injects nothing", () => {
  assert.deepEqual(argsFor(["--no-goat-defaults"]), []);
});

test("goat-owned flags are never forwarded to codex", () => {
  const args = argsFor(["--madmax", "--xhigh", "--print-argv", "--effort", "low"]);
  for (const owned of ["--xhigh", "--print-argv", "--effort", "--madmax=x"]) {
    assert.ok(!args.includes(owned), `${owned} leaked into the codex argv`);
  }
  assert.ok(!args.includes("low"), "the --effort value leaked in as a prompt");
});

test("unknown flags are forwarded to codex verbatim", () => {
  const args = argsFor(["--search", "--model", "gpt-5"]);
  assert.ok(args.includes("--search"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-5"));
});

test("the prompt and passthrough land last, in order", () => {
  const args = argsFor(["fix the bug", "--", "--no-alt-screen"]);
  assert.deepEqual(args.slice(-2), ["fix the bug", "--no-alt-screen"]);
});

// goat's own `../<repo>.goat-worktrees` implementation was retired after 0.1.5 in favour of
// Codex's managed worktrees. The flag must now reach Codex, and `-w <name>` is no longer
// goat's to swallow.
test("--worktree is forwarded to codex, not consumed", () => {
  withCodexVersion("codex-cli 0.155.0", () => {
    const plan = planFor(["--worktree", "--madmax"]);
    assert.ok(plan.args.includes("--worktree"), "--worktree was swallowed");
    assert.ok(!plan.notes.some((note) => note.includes("--worktree")), "no version note on a Codex that has the flag");
  });
});

test("--worktree on a Codex older than 0.155.0 is forwarded with a warning note", () => {
  withCodexVersion("codex-cli 0.147.0", () => {
    const plan = planFor(["--worktree"]);
    assert.ok(plan.args.includes("--worktree"), "the flag must still be forwarded; Codex owns the error");
    assert.ok(
      plan.notes.some((note) => /--worktree.*0\.155\.0.*0\.147\.0/.test(note)),
      `expected a version note, got ${JSON.stringify(plan.notes)}`,
    );
  });
});

test("-w is no longer a goat flag and does not eat the next token", () => {
  const args = argsFor(["-w", "feat/x"]);
  assert.ok(args.includes("-w"));
  assert.ok(args.includes("feat/x"));
});

// A Codex session runs one model, so per-stage routing works by splitting stages across
// sessions that meet through `.goat/`. These pin the precedence rules.
test("--for routes a deliberation stage to Codex's default model", () => {
  assert.equal(modelOf(["--for", "plan"]), "gpt-6-astra");
  assert.equal(modelOf(["--for", "clarify"]), "gpt-6-astra");
  assert.equal(modelOf(["--for", "code-review"]), "gpt-6-astra");
});

test("--for routes an execution stage to the faster model", () => {
  for (const stage of ["ultragoal", "team", "ultraqa"]) {
    assert.equal(modelOf(["--for", stage]), "gpt-5.6-luna", `${stage} routed wrong`);
  }
});

// Astra's catalog entry carries `minimal_client_version = 0.153.0`; the server refuses it
// to older clients. Launching a model that will be refused is worse than launching the
// previous default, so the route falls back and the notes say so.
test("below Codex 0.153.0 the deliberation route falls back to sol and says why", () => {
  withCodexVersion("codex-cli 0.147.0", () => {
    const plan = planFor(["--for", "plan"]);
    assert.equal(plan.args[plan.args.indexOf("-m") + 1], "gpt-5.6-sol");
    assert.ok(
      plan.notes.some((note) => note.includes("gpt-6-astra needs Codex >= 0.153.0") && note.includes("0.147.0")),
      `expected a fallback note, got ${JSON.stringify(plan.notes)}`,
    );
  });
});

test("exactly the minimum version is enough", () => {
  withCodexVersion("codex-cli 0.153.0", () => {
    assert.equal(modelOf(["--for", "plan"]), "gpt-6-astra");
  });
});

test("execution routes carry no version gate and never fall back", () => {
  withCodexVersion("codex-cli 0.100.0", () => {
    const plan = planFor(["--for", "ultragoal"]);
    assert.equal(plan.args[plan.args.indexOf("-m") + 1], "gpt-5.6-luna");
    assert.ok(!plan.notes.some((note) => note.includes("needs Codex")));
  });
});

test("--for accepts the $ and / spellings users type", () => {
  assert.equal(modelOf(["--for", "$plan"]), "gpt-6-astra");
  assert.equal(modelOf(["--for", "/team"]), "gpt-5.6-luna");
});

test("an explicit --model beats the route", () => {
  const args = argsFor(["--for", "plan", "-m", "gpt-5.6-terra"]);
  assert.ok(!args.includes("gpt-6-astra"), "route overrode the user's explicit model");
  assert.ok(args.includes("gpt-5.6-terra"));
});

test("an explicit effort flag beats the route and the default", () => {
  assert.ok(argsFor(["--for", "plan", "--low"]).includes('model_reasoning_effort="low"'));
});

test("--for is never forwarded to codex", () => {
  const args = argsFor(["--for", "plan"]);
  assert.ok(!args.includes("--for"), "--for leaked into the codex argv");
  assert.ok(!args.includes("plan"), "the stage name leaked in as a prompt");
});

test("--no-goat-defaults suppresses routing too", () => {
  assert.deepEqual(argsFor(["--for", "plan", "--no-goat-defaults"]), []);
});

test("an unknown stage is rejected rather than silently ignored", () => {
  assert.throws(() => argsFor(["--for", "nonsense"]), /Unknown stage/);
});

// Codex's effort vocabulary reaches `max` and `ultra`. Until 0.1.6 `--effort max` was
// silently turned into `high` — the opposite of what a wrapper should do with an explicit
// instruction. Whether a given model accepts a level is Codex's error to raise.
test("Codex's full effort vocabulary passes through", () => {
  for (const effort of ["minimal", "max", "ultra"]) {
    assert.ok(argsFor(["--effort", effort]).includes(`model_reasoning_effort="${effort}"`), `${effort} was downgraded`);
  }
});

test("an unknown effort is rejected, not silently replaced", () => {
  assert.throws(() => argsFor(["--effort", "turbo"]), /Unknown reasoning effort 'turbo'/);
});
