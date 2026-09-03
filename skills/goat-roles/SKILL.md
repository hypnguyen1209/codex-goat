---
name: goat-roles
description: Use when a task needs one specific expert lens rather than a full workflow stage. Specialist role cards (planner, executor, verifier, reviewer, security-reviewer, test-engineer, architect, critic, researcher) to adopt for focused sub-tasks. Part of codex-goat.
---

# $goat-roles

Nine role cards. Adopt one when a task needs a specific lens; a stage skill
(`$plan`, `$ultragoal`, `$team`, `$code-review`, `$ultraqa`) already implies its own.

Each card is a reference file in `references/`. Read the one you need — do not read them
all, and do not adopt more than one at a time. Two role cards at once average into
neither.

| Role | File | Adopt when |
| --- | --- | --- |
| Planner | `references/planner.md` | Sequencing work, deciding order and dependencies |
| Executor | `references/executor.md` | Making the change, with verification per step |
| Verifier | `references/verifier.md` | Deciding whether a claim is actually proven |
| Reviewer | `references/reviewer.md` | Judging a diff for correctness and maintainability |
| Security reviewer | `references/security-reviewer.md` | Anything crossing a trust boundary |
| Test engineer | `references/test-engineer.md` | Designing tests that would fail if the code were wrong |
| Architect | `references/architect.md` | Structural decisions with long-lived consequences |
| Critic | `references/critic.md` | Adversarially refuting a plan, finding, or claim |
| Researcher | `references/researcher.md` | Establishing what is true from primary sources |

## From the shell

The same cards drive non-interactive runs:

```sh
goat skills --roles
goat exec --role security-reviewer "Audit the token refresh path in src/auth/"
```

## Rule

A role changes what you look for and what you refuse to accept. It never changes the
evidence standard: a claim still needs a command that ran, and a finding still needs a
concrete failure scenario.
