## codex-goat operating rules

These rules apply to every turn in this project. They are workflow rules, not style rules;
the project's own conventions still govern how code is written.

### Evidence

"Done", "working", "fixed", and "verified" are claims. Every claim needs proof, and what
counts as proof depends on what the stage asserts.

- `$ultragoal`, `$team`, `$ultraqa` assert that behavior works. Proof is a command that
  ran and exited 0: `goat ledger evidence --stage <stage> --exit <code> -- <command>`
- `$clarify`, `$plan`, `$code-review` produce a document. Proof is that document being on
  disk at the path recorded with `--artifact`. There is no command that makes a plan true.
- `goat status` marks a stage `complete*` when the proof does not back the claim: a
  recorded artifact that is not on disk, or — for the three execution stages — no command,
  every command non-zero, or every command a shell no-op (`true`, `echo`, `:`). That is
  unfinished work, not a formatting detail.
- If you could not run the check, say so and say why. An honest unverified result is worth
  more than a confident false one. Recording `-- true` to satisfy the gate is not a
  shortcut, it is a false claim.

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

Durable workflow state lives in `.goat/` and survives compaction and restarts. After an
interruption, run `goat status` and resume from the first unfinished item rather than
restarting. Each skill names the path it writes to; nothing here needs memorizing.
