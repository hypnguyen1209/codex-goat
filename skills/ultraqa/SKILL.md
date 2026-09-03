---
name: ultraqa
description: Use when behavior must be proven by execution rather than reading, before a release, or the user says test this properly, QA it, or make sure it actually works. Adversarial end-to-end QA that runs the real thing against hostile scenarios, then fixes what breaks and cleans up. Part of codex-goat.
---

# $ultraqa

Prove behavior by running it, including the ways a user or an attacker would break it.

A green build is not QA. A passing unit suite is not QA. QA is: the thing ran, hostile
input was thrown at it, and the output was checked.

## Entry contract

`$ultraqa` is independently invocable. It needs something runnable, never a plan.

| Requirement | How it can be satisfied |
| --- | --- |
| `runnable` | A detected project entry point (`package.json`, `Makefile`, `Cargo.toml`, …), **or** an exact command or service given inline |

```sh
goat contract ultraqa
```

## Method

### 1. Plan the matrix

```sh
goat state set --stage ultraqa --status active --summary "<behavior under test>"
```

Write `.goat/qa/<slug>.md` with a scenario table before running anything:

| ID | Intent | Actor | Setup | Command / harness | Expected | Actual | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |

Cover the normal path plus every hostile class that applies:

1. **Malformed input** — invalid JSON, missing fields, wrong types, oversized strings,
   unusual Unicode, path-traversal-shaped values, truncated state files.
2. **Interruption** — cancel mid-run, kill the process, re-run immediately, resume.
3. **Prompt injection** — content that tries to override instructions, skip verification,
   exfiltrate secrets, or claim success. Applies to anything that feeds an LLM.
4. **Stale and conflicting state** — old state files, mismatched sessions, contradictory
   phases, missing timestamps.
5. **Dirty worktree** — pre-existing changes and untracked files must remain untouched.
6. **Hung commands** — every run gets a timeout; a killed child must recover cleanly.
7. **Flaky tests** — re-run a capped number of times; a single lucky green is not a pass.
8. **Misleading success** — success text with a non-zero exit, hidden skips, partial logs.

Declare up front: success criteria, safety bounds, and the stop condition.

### 2. Baseline

Run the project's own verification first (`test`, `build`, `lint`, `typecheck`, as
applicable). Record it:

```sh
goat ledger evidence --stage ultraqa --exit <code> -- <command>
```

A failing baseline stops the cycle. Fix it before adversarial work — hostile results
against a broken baseline mean nothing.

### 3. Run the adversarial scenarios

Execute each row. Capture exit code, output, and artifacts. Fill in **Actual** honestly,
including for scenarios that passed.

Rules while running:

- Every command gets a timeout. No unbounded waits.
- No destructive commands, no production writes, no credential dumping, no unbounded
  process spawning.
- If a scenario cannot be run safely, mark it **blocked**, record why, and record the safe
  substitute you ran instead.
- When a harness itself fails to set up, that is harness debris, not a product defect. Fix
  the harness and re-run before concluding anything about the product.

### 4. Diagnose and fix

For each failure: root cause, then user impact, then safety impact, then the smallest
correct fix. Re-run the scenario and record the new evidence.

Three identical failures on the same scenario stop the cycle with a diagnosis. Five cycles
total is the ceiling — past that, report residual risk instead of iterating.

### 5. Clean up

Before finishing, remove every temporary harness, fixture, log, spawned process, and state
file the run created. Confirm the worktree is in the state you found it, apart from
intentional fixes. Report the cleanup explicitly.

Keep the report under `.goat/qa/` and anything under `.goat/`. That report is this stage's
proof — `goat status` opens the path you record, so deleting it as a temporary file turns a
green run into `complete*`.

### 6. Report

`# UltraQA Report` containing: goal and success criteria · the full scenario matrix ·
commands run with exit codes · failures with root cause and impact · fixes applied with
the evidence that they hold · cleanup status · residual risks.

Close with exactly one of:

- `ULTRAQA COMPLETE` — baseline green, matrix executed, artifacts cleaned, evidence recorded.
- `ULTRAQA STOPPED: max cycles`
- `ULTRAQA STOPPED: same failure 3 times`
- `ULTRAQA BLOCKED: <reason>` — with the owner and the next safe step.

Close the stage with the status that matches the verdict you just wrote. `complete` only
for `ULTRAQA COMPLETE`; a stopped or blocked run is `blocked`, which `goat status` renders
as unfinished:

```sh
# ULTRAQA COMPLETE
goat state set --stage ultraqa --status complete --artifact .goat/qa/<slug>.md \
  --summary "<scenarios run, failures found, fixes applied>"

# ULTRAQA STOPPED or ULTRAQA BLOCKED
goat state set --stage ultraqa --status blocked --artifact .goat/qa/<slug>.md \
  --summary "<what is unproven and who owns the next step>"
```

Writing `complete` for a stopped run is the failure this stage exists to prevent: the
matrix is half-executed, and one passing baseline command is enough to make `goat status`
report it green. Nobody reading it later can tell.

Never write `ULTRAQA COMPLETE` without current evidence in the ledger for the baseline and
every non-blocked scenario.
