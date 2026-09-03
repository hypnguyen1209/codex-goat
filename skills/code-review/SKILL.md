---
name: code-review
description: Use when the user says review this, check my changes, look at this PR or diff, or before merging. Reviews a concrete change across correctness, security, performance, and test coverage, then adversarially verifies each finding before reporting it. Part of codex-goat.
---

# $code-review

Find defects in a change and report only the ones that survive an attempt to refute them.

## Entry contract

`$code-review` is independently invocable. It needs a change, never a plan.

| Requirement | How it can be satisfied |
| --- | --- |
| `changed-scope` | Uncommitted changes in the working tree, **or** a commit range, branch, or explicit file list given inline |

```sh
goat contract code-review
```

If nothing is uncommitted and no scope was given, ask which scope to review. Do not
default to reviewing the entire repository — a review with no boundary produces a list
nobody reads.

## Method

### 1. Fix the scope

```sh
git status --porcelain
git diff --stat                    # uncommitted
git diff --stat main...HEAD        # branch scope
goat state set --stage code-review --status active --summary "<scope>"
```

State the scope in the report. Every finding must sit inside it.

### 2. Read the change with intent

Read the full diff plus enough surrounding context to judge it. A hunk read in isolation
produces confident nonsense.

### 3. Review each dimension

Run all four. Skipping one silently is worse than reporting it as not applicable.

| Dimension | Looking for |
| --- | --- |
| **Correctness** | Wrong logic, unhandled cases, off-by-one, null/undefined, race conditions, error paths that swallow failures, resource leaks |
| **Security** | Injection, path traversal, unvalidated input crossing a trust boundary, secrets in code or logs, authz gaps, unsafe deserialization |
| **Performance** | N+1 queries, work inside loops that belongs outside, unbounded growth, blocking I/O on a hot path, missing pagination |
| **Test coverage** | New behavior with no test, changed behavior with unchanged tests, tests asserting mocks instead of behavior, deleted assertions |

### 4. Refute every finding before reporting it

For each candidate, argue **against** it before you write it down:

- Is this reachable in real usage, with real inputs?
- Is it already handled by a caller, a type, or a framework guarantee?
- Can I write the concrete failing input?

Drop anything you cannot give a concrete failure scenario for. A review of six real
defects beats a review of thirty maybes, and the thirty-item list trains people to
ignore reviews.

### 5. Report

Save to `.goat/reviews/<slug>.md`, ordered most severe first:

```markdown
## <severity>: <one-line claim>
- Where: `path/to/file.ts:123`
- Failure: <concrete inputs or state -> wrong output, crash, or exposure>
- Why real: <why the obvious defense does not cover it>
- Fix: <smallest correct change>
```

Severities: **critical** (data loss, security, corruption) · **high** (wrong behavior on a
real path) · **medium** (wrong behavior on an edge path) · **low** (maintainability).

Then close:

```sh
goat state set --stage code-review --status complete --artifact .goat/reviews/<slug>.md \
  --summary "<n> findings across <scope>"
```

The report file **is** the proof for this stage — `goat status` opens the path you
recorded, and a path that is not on disk reports `complete*`. You also ran the project's
linter (see [Out of scope](#out-of-scope)), so record that too; a command is stronger proof
than a document:

```sh
goat ledger evidence --stage code-review --exit <code> -- <the linter you ran>
```

### 6. Say so when it is clean

"No findings that survived verification across correctness, security, performance, and
test coverage in `<scope>`" is a complete, valuable review. Do not invent findings to
justify the run.

## Out of scope

Style and formatting the project's own linter already enforces. Run the linter; do not
hand-review what a tool decides. Report a lint failure as one finding, not thirty.

## Handoff

- `$ultragoal` — fix the findings with evidence per fix.
- `$ultraqa` — when findings point at runtime behavior rather than code shape.
