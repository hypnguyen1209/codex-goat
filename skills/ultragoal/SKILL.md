---
name: ultragoal
description: Execute an objective to completion as durable goals with checkpointed evidence, surviving compaction and session restarts. Use for multi-step implementation work, when a task must be finished across several turns, or when the user says execute this, ship it, finish the plan, or work until done. Part of codex-goat.
---

# $ultragoal

The default execution path. Break an objective into goals, drive each to done, and prove
each one with a command that actually ran.

## Entry contract

`$ultragoal` is independently invocable. It does **not** require `$plan` to have run.

| Requirement | How it can be satisfied |
| --- | --- |
| `objective` | Stated in the invocation, or on record in `.goat/state/state.json` |
| `plan` | A completed `$plan` artifact, **or** an approach stated inline in the invocation |

```sh
goat contract ultragoal
```

When `plan` reports `inline`, do not silently run `$plan`. Write a short approach — goals,
order, verification — confirm it in one line, and proceed. When the work is large enough
that the approach itself needs review, say so and hand off to `$plan`.

## Do not use when

- The task is one edit with one obvious check. Just do it.
- Requirements are unclear. `$clarify`.
- The user wants a plan, not a change. `$plan`.

## Method

### 1. Open the run

```sh
goat state set --stage ultragoal --status active --objective "<objective>"
```

Write `.goat/goals/<slug>.md`:

```markdown
# <objective>

## Goals
- [ ] G1 — <outcome> · verify: `<command>`
- [ ] G2 — <outcome> · verify: `<command>`

## Done means
<the observable end state, in one sentence>
```

Every goal names its verification command up front. A goal whose verification you cannot
name yet is not a goal — it is a question, and it belongs in `$clarify`.

### 2. Drive each goal

For each goal, in order:

1. **Make the change.** Smallest edit that achieves the outcome.
2. **Run the verification command.** Actually run it. Capture the exit code.
3. **Record the evidence:**
   ```sh
   goat ledger evidence --stage ultragoal --exit <code> -- <command>
   ```
4. **Tick the box** in the goals file only after step 3 passed.

If verification fails, fix and re-run. After three failures on the same goal with the same
root cause, stop and report — repeated identical failures mean the diagnosis is wrong, and
a fourth attempt will not fix it.

### 3. Close the run

Only when every box is ticked and every goal has recorded evidence:

```sh
goat state set --stage ultragoal --status complete --artifact .goat/goals/<slug>.md \
  --summary "<what shipped>"
goat status
```

`goat status` reports any stage marked complete with no evidence as `complete*`. If your
run shows `complete*`, it is not done — go record the proof or reopen the goal.

## The claim gate

Never write "done", "complete", "working", or "verified" without a command in the ledger
that supports it. If you did not run it, say you did not run it, and say why:

> G3 implemented but unverified: the e2e suite needs a live database, unavailable in this
> environment. Verified the unit path only (`npm run test:unit`, exit 0).

That sentence is worth more than a confident false claim, and it is the only acceptable
form of an unproven goal.

## Interruption and resume

State and ledger live on disk, so a compaction or a restart loses nothing. On resume:

```sh
goat status
```

Continue from the first unticked goal. Do not restart completed goals, and do not re-plan
work that already has evidence.

## Handoff

- `$team` — when a remaining goal splits into 2+ independent lanes.
- `$code-review` — review the resulting change.
- `$ultraqa` — adversarial end-to-end QA of the shipped behavior.
