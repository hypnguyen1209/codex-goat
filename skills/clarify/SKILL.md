---
name: clarify
description: Resolve an ambiguous request into frozen, execution-ready requirements by asking only the questions the codebase cannot answer. Use when a request is vague, could reasonably mean several different things, or when the user says help me think this through or I am not sure what I want yet. Part of codex-goat.
---

# $clarify

Turn a vague request into requirements someone could execute without guessing.

## Entry contract

`$clarify` has no prerequisites. It is the one stage that can always start.

## Do not use when

- The request is already specific and bounded. Clarifying a clear request wastes the
  user's turn and makes them repeat themselves.
- The unknowns are facts about the codebase. Those are not questions for the user — go
  read the code.

## The question rule

Before asking anything, classify it:

| Kind | Example | Action |
| --- | --- | --- |
| **Codebase fact** | "Where is auth handled?" | Read the code. Never ask. |
| **User preference** | "Which should we optimize for?" | Ask. |
| **Scope decision** | "Does this include the admin path?" | Ask. |
| **Business constraint** | "Can we break this API?" | Ask. |

Asking a codebase fact tells the user you did not look. Read first, then ask informed
questions — the answers are better and there are fewer of them.

## Method

1. **Read first.** Find the code the request touches. Note what is already decided by
   existing structure; those are not open questions.

2. **Ask one question at a time.** Each question offers concrete options with their
   trade-offs, not an open prompt. Batching five questions gets one answered.

3. **Build on the answer.** Each answer narrows the space; re-derive what is still open
   before asking again. Usually two or three questions is the whole interview.

4. **Stop when it is executable.** Requirements are done when you could hand them to
   someone else and they would not need to ask you anything. Continuing past that point
   is interrogation, not clarification.

5. **Freeze it.** Write `.goat/plans/<slug>-requirements.md`:

   ```markdown
   # <request in one sentence>

   ## Decided
   - <requirement> — decided because <the user's answer>

   ## Explicitly out of scope
   - <thing> — because <reason>

   ## Assumptions
   - <assumption> — invalidated if <signal>

   ## Open, deferred
   - <question> — deferred because <reason>, decide before <point>
   ```

   ```sh
   goat state set --stage clarify --status complete \
     --artifact .goat/plans/<slug>-requirements.md \
     --objective "<the now-clear objective>"
   ```

   Recording `--objective` is what lets `$plan`, `$ultragoal`, and `$team` start without
   re-asking. Check it landed with `goat contract plan`.

## Never

Do not write code, edit files, or start implementing from inside `$clarify`. The output is
requirements. If the user says "just do it" mid-interview, stop interviewing and hand off
to `$ultragoal` with whatever is decided so far.

## Handoff

- `$plan` — design the approach against these requirements.
- `$ultragoal` — execute directly when the approach is already obvious.
