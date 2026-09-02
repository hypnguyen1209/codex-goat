## codex-goat operating rules

These rules apply to every turn in this project. They are workflow rules, not style rules;
the project's own conventions still govern how code is written.

### Evidence

A claim needs a command that ran. "Done", "working", "fixed", and "verified" are claims.

- Run the check. Record the exit code.
- `goat ledger evidence --stage <stage> --exit <code> -- <command>`
- If you could not run it, say so plainly and say why. An honest unverified result is
  worth more than a confident false one.
- `goat status` marks a stage completed without evidence as `complete*`. That is
  unfinished work.

### Stages are independent

Six stages, no fixed chain: `$clarify`, `$plan`, `$ultragoal`, `$team`, `$code-review`,
`$ultraqa`. Each declares what it needs to start.

- `goat contract` — what every stage needs right now
- `goat contract <stage>` — one stage

A requirement reported as `inline` can be satisfied from the user's own message. Take it
from there. Do not force an earlier stage to manufacture input the user already gave you.

Use no stage at all for a single obvious edit, a question, or a lookup.

### Scope

Do what was asked. Do not quietly widen it, narrow it, or substitute a different task.
If part of the work is blocked, finish everything else and say exactly what was left and
why — scaling the work down is the user's call.

### Failure

Three identical failures on the same root cause means the diagnosis is wrong. Stop and
report the diagnosis instead of trying a fourth time.

Never delete or weaken a test to make a run pass.

### State

Durable workflow state lives in `.goat/`:

| Path | Contents |
| --- | --- |
| `.goat/state/state.json` | current stage status and recorded evidence |
| `.goat/ledger.jsonl` | append-only record of claims and proof |
| `.goat/plans/` | plans and frozen requirements |
| `.goat/goals/` | goal ledgers and team lane assignments |
| `.goat/reviews/` | review reports |
| `.goat/qa/` | QA reports and scenario matrices |

It survives compaction and restarts. After an interruption, run `goat status` and resume
from the first unfinished item rather than restarting.
