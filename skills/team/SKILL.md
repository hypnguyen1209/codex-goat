---
name: team
description: Split work into independent parallel lanes, run them concurrently, and merge the results with per-lane evidence. Use when a task has 2 or more genuinely independent workstreams, or when the user says in parallel, split this up, or run these at the same time. Part of codex-goat.
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

### 2. Run the lanes

Each lane, independently:

1. Implement only inside its owned files.
2. Run its verification command.
3. Record evidence, tagged with the lane:
   ```sh
   goat ledger evidence --stage team --exit <code> -- <command>   # L<n>: <lane name>
   ```

A failing lane does not stop the others. Record it as blocked, keep the rest moving, and
report it at merge.

### 3. Merge

1. Merge in the declared order.
2. Run the **whole** project's verification, not just the per-lane commands. Lanes that
   pass alone can still break together — this run is the point of the merge step.
3. Record the merged evidence:
   ```sh
   goat ledger evidence --stage team --exit <code> -- <full verification command>
   ```

### 4. Close

```sh
goat state set --stage team --status complete --artifact .goat/goals/<slug>-team.md \
  --summary "<lanes merged, what shipped>"
```

## Report contract

Return, per lane: name, owned files, outcome, verification command and exit code, and
blocked status if any. Then the merged verification result. A lane with no evidence is
reported as unverified, never as done.

## Handoff

- `$code-review` — review the merged change as one unit.
- `$ultraqa` — adversarial QA once merged behavior is runnable.
