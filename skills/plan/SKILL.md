---
name: plan
description: Use when work needs a written plan before code, when a request spans more than one file or subsystem, or the user says plan, design the approach, or how should we do this. Produces an evidence-backed implementation plan with testable acceptance criteria. Part of codex-goat.
---

# $plan

Turn an objective into a plan someone else could execute without asking you a question.

## Entry contract

`$plan` is independently invocable. It never requires an earlier stage to have run.

| Requirement | How it can be satisfied |
| --- | --- |
| `objective` | Stated in the invocation, **or** taken from a completed `$clarify` artifact, **or** already on record in `.goat/state/state.json` |

Check it yourself before starting:

```sh
goat contract plan
```

If `objective` reports `inline`, the user's message must contain it. If the message is
too vague to plan against, ask **one** question, or hand off to `$clarify` — do not guess
and do not produce a plan padded with assumptions.

## Do not use when

- The change is a single obvious edit in a single file. Just make it.
- The user asked for execution and the approach is already settled. Use `$ultragoal`.
- Requirements are genuinely unknown and multi-branched. Use `$clarify` first.

## Method

1. **Record the objective.**
   ```sh
   goat state set --stage plan --status active --objective "<one sentence>"
   ```

2. **Gather facts before opinions.** Read the code paths the change touches. Every claim
   in the plan cites `file:line`. A plan that describes code you did not open is fiction.

3. **Write the plan.** Save to `.goat/plans/<slug>.md` with exactly these sections:

   - **Objective** — one sentence, outcome-shaped.
   - **Context** — what exists today, each claim citing `file:line`.
   - **Acceptance criteria** — each one testable by a command or an observation. No
     "works correctly", no "is robust". If you cannot name how it is checked, it is not a
     criterion.
   - **Steps** — ordered, each naming the files it touches and its verification.
   - **Risks** — each with a mitigation and the signal that it is happening.
   - **Out of scope** — what this plan deliberately does not do.
   - **Verification** — the exact commands that prove the whole plan landed.

4. **Right-size.** Three steps for a small change is correct. Fifteen steps for a small
   change is padding, and padding hides the real work.

5. **Close out.**
   ```sh
   goat state set --stage plan --status complete --artifact .goat/plans/<slug>.md \
     --summary "<what the plan delivers>"
   ```

   The plan file **is** the proof for this stage — `goat status` opens the path you
   recorded. Write the file before you close the stage; a path that is not on disk reports
   `complete*` and exits non-zero. If you ran a check while planning (verifying a cited
   path exists, say), record it too — a command is stronger proof than a document:

   ```sh
   goat ledger evidence --stage plan --exit <code> -- <the command you ran>
   ```

## Quality bar

Refuse to mark the plan complete unless all of these hold:

- [ ] Every context claim cites `file:line`, and every cited path exists.
- [ ] Every acceptance criterion names its check.
- [ ] Every step names the files it touches.
- [ ] Every risk has a mitigation and a detection signal.
- [ ] Out-of-scope is non-empty, or the objective genuinely covers everything.

## Handoff

State what is now unblocked; do not start it:

- `$ultragoal` — durable execution of this plan with checkpoint evidence.
- `$team` — when the steps split into 2+ genuinely independent lanes.
- `$code-review` — if the plan was written against an existing change.

Never implement from inside `$plan`. Planning that edits code produces neither a
reviewable plan nor a reviewable change.
