---
name: team
description: Use when a task has 2 or more genuinely independent workstreams, or the user says in parallel, split this up, or run these at the same time. Splits work into independent lanes, runs them concurrently, and merges the results with per-lane evidence. Part of codex-goat.
---

# $team

Parallel execution across lanes that do not touch each other. Coordination is not free —
use this only when the work genuinely splits.

## Entry contract

`$team` is independently invocable.

| Requirement | How it can be satisfied |
| --- | --- |
| `objective` | Stated inline, or on record |
| `parallel-lanes` | Derived from a `$plan` artifact, **or** described inline as 2+ independent lanes |

```sh
goat contract team
```

## The independence test

Before splitting, every pair of lanes must pass all three:

1. **Disjoint files.** No two lanes edit the same file. Shared files are a merge conflict
   waiting to happen, and resolving them costs more than the parallelism saved.
2. **No ordering dependency.** Lane B does not need Lane A's output to start.
3. **Independent verification.** Each lane can be verified on its own.

If any pair fails, they are one lane. **One lane is not a team** — run `$ultragoal`
instead and say so:

> This splits into 1 real lane (all three candidates edit `src/router.ts`). Running
> `$ultragoal` instead; `$team` would add coordination cost for no parallelism.

## Method

### 1. Declare the split

```sh
goat state set --stage team --status active --objective "<objective>"
```

Write `.goat/goals/<slug>-team.md`:

```markdown
# <objective>

## Lanes
### L1 — <name>
- Files: <exact paths this lane owns>
- Outcome: <what done looks like>
- Verify: `<command>`

### L2 — <name>
...

## Merge order
<L1, L2, ... and why>

## Shared invariants
<what every lane must not break>
```

File ownership is exclusive. A lane that needs a file it does not own stops and reports;
it does not reach across.

### 2. Run the lanes as parallel agents

This step explicitly asks for parallel agent work: spawn one sub-agent per lane with
`spawn_agent` and let them run at the same time. Codex's spawn tool tells the model not to
spawn unless a skill or the user asks for delegation in so many words — this sentence is
that request.

Each spawn message is the lane's own section of `.goat/goals/<slug>-team.md`, verbatim,
followed by:

> You are lane L<n> of a `$team` run. Other agents are editing other files in this
> checkout right now: touch only your owned files, do not revert their edits, and do not
> run `goat state` or `goat ledger` — the root records evidence. Implement the outcome,
> run the verify command, and end with exactly one line:
> `LANE L<n> <name>: files=<paths> verify=<command> exit=<code> status=done|blocked — <one line>`

Rules for the spawn:

- Start each lane fresh. Its message is self-contained, so it does not need this
  conversation: if the tool offers `fork_context`, set it `false`; if it offers
  `fork_turns`, pass `"none"`.
- Leave `model` unset: a lane is a separate thread seeded from this session, so it runs the
  same model and effort you are running. If this session is on an expensive deliberation
  model and the lanes are routine implementation, say so in your report rather than
  silently spending it — `goat --for team` starts the whole session on the execution model.
- Omit `agent_type`: a lane runs the default agent with its brief as its whole task. (`executor` is the only role card written for implementation work; if you
  deliberately want it as a lane's developer message, say so in the lanes file.)
- Never put a `$stage` sigil in a spawn message; a lane is not a stage invocation.
- Spawn at most what this session allows open at once. Codex states the budget in your own
  prompt ("There are N available concurrency slots … including you"); keep at most N-1 lanes
  open. If nothing states a limit, start at six, and if a spawn is refused for capacity,
  treat that refusal as the limit and keep every later batch at that size.
- If the tool set offers `close_agent`, a finished lane keeps its slot until you close it:
  record its evidence, close it, then spawn the next batch. If there is no `close_agent` in
  the tool set, a finished lane is reclaimed for you — record its evidence and keep going.
  Do not wait for a slot that has already been freed.
- `wait_agent` with several ids returns as soon as the first one finishes. Call it again
  with the lanes still outstanding until every lane has reported. A blocked lane does not
  stop the others.

As each lane returns, verify it **from here**. Its last line tells you what to run, not
what to write: re-run the lane's verify command yourself and record the exit code you
observed, tagged with the lane:

```sh
<lane verify command>; echo "exit=$?"
goat ledger evidence --stage team --exit <observed code> -- <command>   # L<n>: <lane name>
```

If the command cannot run from here, record nothing for that lane and report it as
unverified.

Lanes do not write the ledger themselves. State is a read-modify-write of one file, and two
lanes finishing together would overwrite each other's proof — a silent loss that `goat
status` cannot see. One writer, the root, serialises it.

If `spawn_agent` is not available in this session, run the lanes yourself, one after
another, with exactly the same ownership rules. `$team` still holds without parallelism; it
just stops being faster.

### 3. Merge

1. Merge in the declared order.
2. Run the **whole** project's verification, not just the per-lane commands. Lanes that
   pass alone can still break together — this run is the point of the merge step.
3. Record the merged evidence:
   ```sh
   goat ledger evidence --stage team --exit <code> -- <full verification command>
   ```

### 4. Close

`complete` only when every lane merged and the whole-project verification exited 0. If any
lane is still blocked, close `blocked` — this stage tells lanes to keep moving past a
failure, so arriving here with one unresolved is an expected outcome, not an error:

```sh
# every lane merged, full verification green
goat state set --stage team --status complete --artifact .goat/goals/<slug>-team.md \
  --summary "<lanes merged, what shipped>"

# any lane blocked, or the merged verification failed
goat state set --stage team --status blocked --artifact .goat/goals/<slug>-team.md \
  --summary "<which lanes landed, which did not, who owns the rest>"
```

The merged verification command is this stage's proof, and the report file must be on disk
at the path you record — `goat status` opens it, and a path that was never written reports
`complete*`. Lane commands alone do not close the stage: they prove lanes, not the merge.

## Report contract

Return, per lane: name, owned files, outcome, verification command and exit code, the
agent that ran it, and blocked status if any. Then the merged verification result. A lane
with no evidence is reported as unverified, never as done.

## Handoff

- `$code-review` — review the merged change as one unit.
- `$ultraqa` — adversarial QA once merged behavior is runnable.
