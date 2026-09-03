<div align="center">

# codex-goat

**A stronger default for [OpenAI Codex CLI](https://github.com/openai/codex).**

Better prompts, one consistent workflow, and runtime helpers that make "done" auditable.
Codex stays the execution engine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

</div>

---

codex-goat does not replace Codex, wrap its model calls, or fork its source. It keeps
Codex as the execution engine and makes it easier to:

- **start a stronger Codex session by default** — `goat` launches `codex` with raised
  reasoning effort, optional worktree isolation, and project guidance already loaded
- **run one consistent workflow from clarification to completion** — six stages that
  share a state directory, an evidence ledger, and one set of operating rules
- **invoke that workflow with `$plan`, `$ultragoal`, `$team`, `$code-review`, and
  `$ultraqa` — each independently, no fixed chain**
- **keep plans, goals, reviews, and state in `.goat/`**, surviving compaction and restarts

## Install

```bash
codex --version                  # Codex CLI must already be installed and authenticated
npm install -g codex-goat

cd your-project
goat setup --scope project
goat doctor
goat exec "Reply with exactly GOAT-OK"
```

`goat doctor` checks the install shape. `goat exec` is the real smoke test — it forces
Codex to authenticate and complete a model call. A green doctor with a failing exec means
an auth or profile problem, not an install problem.

Then work normally:

```bash
goat --worktree=feat/checkout --madmax --xhigh
```

Inside the session, invoke whichever stage the work actually needs:

```text
$plan       "design the checkout fix"
$ultragoal  "implement the approved plan with checkpoint evidence"
$code-review
$ultraqa    --tests
```

<details>
<summary><strong>Install as a Codex plugin instead</strong></summary>

The repository is also a valid Codex plugin (`.codex-plugin/plugin.json`), installable
through Codex's own plugin system. These are shell commands, not slash commands — Codex's
TUI has `/plugins` for browsing, but installing happens on the CLI:

```bash
codex plugin marketplace add https://github.com/hypnguyen1209/codex-goat
codex plugin add codex-goat@codex-goat
```

The marketplace entry resolves to the **npm** package, because that is the only channel
that carries built code: `dist/` is generated at publish time and is not committed, so a
plugin installed straight from a git checkout would register three hooks that run, exit 0,
and inject nothing.

Plugin mode gives you the skills, the role cards, and the lifecycle hooks. It does **not**
give you the `goat` CLI, which the skills use for state, contracts, and the evidence
ledger — without it, every evidence step in every skill is a no-op. Install both, or use
`goat setup` alone.

**Codex must trust a hook before it runs it.** A freshly registered hook is `Untrusted`
and is skipped silently; approve it at the next launch prompt or via `/hooks`. Note that
`codex exec` has no trust prompt, so hooks stay inert there until trust is granted
interactively at least once.

</details>

## The idea: entry contracts, not a pipeline

Most workflow layers give you a chain: clarify → plan → execute → review → QA. Real
requests almost never start at the beginning. "Review my changes" has no plan. "Test this
properly" has no objective. Forcing a chain makes the tool fight the user.

codex-goat replaces the chain with **entry contracts**. Each stage declares what it needs
to start, and every requirement can be satisfied three ways: by a previous stage, by the
working tree, or by the user simply saying it in the invocation.

| Stage | Needs | Produces |
| --- | --- | --- |
| `$clarify` | nothing | frozen requirements + a recorded objective |
| `$plan` | an objective | plan with testable acceptance criteria |
| `$ultragoal` | an objective + an approach | goal ledger with per-checkpoint evidence |
| `$team` | an objective + 2+ independent lanes | lane assignments and merged evidence |
| `$code-review` | a change | verified findings, most severe first |
| `$ultraqa` | something runnable | scenario matrix and QA report |

Ask the tool where you stand at any moment:

```bash
goat contract              # every stage: what is already satisfied, what to state inline
goat contract ultragoal    # one stage
```

```text
$ultragoal: ready
     objective: satisfied — objective on record: ship the checkout fix
     plan: inline — supply an approved plan inline, or run $plan first
```

`inline` means *the user's own message can satisfy this* — so the stage proceeds. Nothing
is ever hard-blocked, and that is enforced by the type: `RequirementVerdict` is
`satisfied | inline`, with no third case, and a bundle check fails if the union grows.

## Evidence: what makes "done" mean something

Every stage records proof in an append-only ledger:

```bash
goat ledger evidence --stage ultragoal --exit 0 -- npm test
```

`goat status` then reconciles claims against proof and marks anything that does not hold
up as `complete*`. Three things fail the check: no evidence at all, a command that exited
non-zero, and a shell no-op like `true` that exits 0 without testing anything.

```text
$plan          complete   ready
     artifact: .goat/plans/checkout.md
     last evidence: npm test -> exit 0
$ultragoal     complete*  ready
     unproven: every recorded command failed (last: npm test -> exit 1)

goat warn 1 stage(s) marked complete without evidence that backs the claim (shown as complete*).
```

`goat status` exits non-zero when that happens, so CI can gate on it. This is the single
rule that separates finished work from a confident claim about finished work, and every
bundled skill enforces it.

## Command surface

```text
goat [flags] [codex args...]           launch Codex with stronger defaults
  --high | --xhigh | --medium | --low  reasoning effort (default: high)
  --effort <level>                     the same, explicit
  --madmax                             codex --dangerously-bypass-approvals-and-sandbox
  --worktree[=<name>] | -w <name>      run inside a dedicated git worktree
  --no-goat-defaults                   forward argv to codex untouched
  --print-argv                         print the resolved codex command and exit
  --                                   everything after this goes to codex verbatim

goat setup [--scope user|project] [--force]
goat doctor
goat exec [--role <name>] "<prompt>"
goat status
goat contract [<stage>] [--json]
goat state read|set|clear
goat ledger read|evidence|note
goat skills [--roles]
goat hook
goat uninstall [--scope ...] [--purge-state]
```

Nothing is hidden. `goat --print-argv` shows the exact command that would run:

```bash
$ goat --madmax --xhigh -m gpt-5 "fix the bug" --print-argv
codex -c 'model_reasoning_effort="xhigh"' --dangerously-bypass-approvals-and-sandbox -m gpt-5 'fix the bug'
```

Flags codex-goat does not own are forwarded to Codex in the order you typed them.

## Role cards

Nine specialist prompts for focused sub-tasks — planner, executor, verifier, reviewer,
security-reviewer, test-engineer, architect, critic, researcher. Each states what the role
does, what it **refuses**, and the shape of its output.

```bash
goat skills --roles
goat exec --role security-reviewer "Audit the token refresh path in src/auth/"
```

Inside a session they are the `$goat-roles` skill. Adopt one at a time; two role cards at
once average into neither.

## Runtime helpers

Three Codex lifecycle hooks, registered by `goat setup`:

| Event | What it does |
| --- | --- |
| `SessionStart` | Injects the active objective, in-flight stages, unproven claims, and a memory digest. Matches all four sources — `startup`, `resume`, `clear`, **`compact`** — so the state is re-injected after a compaction, which is exactly when the model has lost it |
| `UserPromptSubmit` | When a prompt invokes a stage, attaches that stage's entry-contract report |
| `Stop` | Records the turn's outcome into session memory |

Three properties hold for every hook, and are covered by tests in both implementations:

1. **Never blocks.** No hook can return a block decision.
2. **Never throws.** Malformed input exits 0 with `{}`.
3. **Never phones home, and stays cheap.** Local file reads, plus at most one
   `git status --porcelain` (5s timeout) — and only when a prompt explicitly invokes a
   stage whose contract depends on the working tree. Ordinary prompts run no subprocess.

**Session memory** is a local, append-only log under `.goat/memory/`. Prose is compressed;
code spans, paths, URLs, filenames, and version numbers are preserved byte-for-byte.
`<private>…</private>` is stripped before anything reaches disk.

### The native fast path

`crates/goat-runtime` is an optional dependency-free Rust binary that handles
`SessionStart` and `Stop` in a few milliseconds instead of paying Node's startup cost:

```bash
npm run build:native
```

It is genuinely optional — `hooks/goat-hook.mjs` falls back to the TypeScript handler when
the binary is absent, and `UserPromptSubmit` is always delegated to Node because the stage
table has one source of truth in TypeScript. The one piece of logic both implementations
share, the memory compressor, is pinned by a fixture that
[both test suites read](./crates/goat-runtime/tests/fixtures/compress.json), so they
cannot drift.

## What lives where

```text
.goat/
├── state/state.json     current stage status and recorded evidence
├── ledger.jsonl         append-only record of claims and proof
├── plans/               plans and frozen requirements
├── goals/               goal ledgers and team lane assignments
├── reviews/             review reports
├── qa/                  QA reports and scenario matrices
└── memory/              compressed session observations
```

`goat setup` also writes:

- `<scope>/.agents/skills/` — the eight bundled skills plus the role cards
- `AGENTS.md` — operating rules, merged between `<!-- GOAT:AGENTS:START/END -->` markers
  so the rest of your file is preserved byte-for-byte
- `.codex/hooks.json` — lifecycle hooks, preserving any entries owned by other tools

`goat uninstall` reverses all three and leaves `.goat/` alone unless you pass
`--purge-state`.

## Development

```bash
npm install
npm run build            # TypeScript -> dist/
npm run build:native     # optional Rust helper
npm run build:bun        # optional single-file binary (bun build --compile)

npm test                 # build + 84 unit tests + 81 bundle contract checks
npm run test:native      # 18 Rust tests
npm run verify           # lint + everything above
```

The Bun binary embeds the code but not `skills/`, `prompts/`, `templates/`, or `hooks/`.
Commands that read those — `setup`, `doctor`, `skills`, `exec --role` — need
`GOAT_HOME=/path/to/codex-goat`. State and workflow commands work without it.

`npm run test:contract` is the check that catches what unit tests cannot: a SKILL.md whose
frontmatter Codex would reject, a declared stage with no skill, a role prompt missing from
the `$goat-roles` index, or a hook registration pointing at a file the package does not
ship.

```text
codex-goat/
├── src/
│   ├── cli/             argv parsing, launch, and the goat subcommands
│   ├── core/            paths, atomic filesystem writes, process, logging
│   ├── state/           stage table, entry contracts, state store, ledger, memory
│   ├── setup/           AGENTS.md merging, hooks.json merging
│   └── hooks/           the lifecycle hook handler
├── skills/              the eight bundled skills
├── prompts/             the nine role cards (source of truth)
├── templates/           the AGENTS.md guidance block
├── hooks/               plugin hook registrations and the entry script
└── crates/goat-runtime/ optional native helper
```

## Credits

codex-goat follows the shape established by
[oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) — the canonical stage names and
the "keep Codex as the execution engine" framing come from there. It borrows the
preserve-code-and-paths compression idea from
[cavemem](https://github.com/JuliusBrussee/cavemem), and the cross-harness plugin
packaging conventions from [ECC](https://github.com/affaan-m/ECC).

## License

MIT — see [LICENSE](./LICENSE).
