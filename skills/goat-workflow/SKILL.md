---
name: goat-workflow
description: Use when unsure whether to plan, execute, review, or QA, or the user asks what should we do next. Chooses which codex-goat stage fits the current request and checks whether it can start right now. Part of codex-goat.
---

# $goat-workflow

One consistent workflow, six independent entry points. This card decides which one.

## The stages

| Stage | Use when | Needs |
| --- | --- | --- |
| `$clarify` | The request could mean several different things | nothing |
| `$plan` | The approach needs to be written down and agreed | an objective |
| `$ultragoal` | Work needs finishing, with proof, across turns | an objective + an approach |
| `$team` | The work splits into 2+ independent lanes | an objective + real lanes |
| `$code-review` | A concrete change needs judging | a change |
| `$ultraqa` | Behavior needs proving by execution | something runnable |

## There is no fixed chain

The usual order is clarify → plan → execute → review → QA, but **nothing enforces it**,
because most real requests do not start at the beginning:

- "Review my changes" → `$code-review`. No plan, no objective needed.
- "Test this properly" → `$ultraqa`. Straight in.
- "Fix the login bug, tests must pass" → `$ultragoal`. The approach is already implied.
- "I'm not sure what I want" → `$clarify`.

Ask what the request needs, not what stage comes next in a diagram.

## Routing

1. **Is there a concrete change to judge?** → `$code-review`
2. **Is there runnable behavior to prove?** → `$ultraqa`
3. **Is the request ambiguous enough that two people would build different things?** → `$clarify`
4. **Is the approach contested, risky, or spanning subsystems?** → `$plan`
5. **Does it split into 2+ lanes with disjoint files?** → `$team`
6. **Otherwise** → `$ultragoal`

If none of these fit — a single obvious edit, a question, a lookup — use no stage at all.
Loading a workflow for a one-line fix is the most common way to waste a session.

## Check before you start

```sh
goat contract            # every stage: ready, or what is missing
goat contract ultraqa    # one stage
goat status              # what has already run, and what it proved
```

A requirement reported as `inline` means the user's own message can satisfy it. Take it
from there and proceed — do not force an earlier stage to manufacture it.

## Evidence is the constant

Whatever stage runs, the rule does not change: a claim needs a command that ran.

```sh
goat ledger evidence --stage <stage> --exit <code> -- <command>
```

`goat status` marks a stage `complete*` when its evidence does not back the claim — none
recorded, every command exited non-zero, or every command is a shell no-op. Treat that as
unfinished work, not as a formatting detail.
