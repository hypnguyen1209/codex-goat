# Changelog

All notable changes to codex-goat are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-03

First release.

### Added

**Workflow — six stages, no fixed chain**

- `$clarify`, `$plan`, `$ultragoal`, `$team`, `$code-review`, `$ultraqa`, each with an
  explicit entry contract so it can be invoked on its own.
- `goat contract [<stage>]` reports, per requirement, whether it is already satisfied or
  can be satisfied inline from the user's own message. No requirement is ever hard-blocking.
- `$goat-workflow` routing card for choosing a stage, and `$goat-roles` indexing nine
  specialist role prompts.

**Evidence ledger**

- `goat ledger evidence --stage <stage> --exit <code> -- <command>` records proof.
- `goat status` reconciles claims against proof, marks any stage completed without evidence
  as `complete*`, and exits non-zero so CI can gate on it.
- Durable state under `.goat/`: `state/state.json`, `ledger.jsonl`, and per-stage artifact
  directories. State reads repair malformed files rather than throwing.

**CLI**

- `goat` launches Codex with raised reasoning effort (`high` by default), `--madmax` for
  the Codex sandbox bypass, and `--worktree` for isolated aggressive sessions.
- Flags codex-goat does not own are forwarded to Codex in the order they were typed.
- `--print-argv` prints the resolved, shell-quoted Codex command without side effects.
- `goat setup`, `doctor`, `exec`, `status`, `contract`, `state`, `ledger`, `skills`,
  `hook`, `uninstall`.
- `goat setup` merges into `AGENTS.md` between markers and into `hooks.json` by ownership,
  preserving foreign content in both. `goat uninstall` reverses exactly that and keeps
  `.goat/` unless `--purge-state` is passed.

**Runtime helpers**

- `SessionStart`, `UserPromptSubmit`, and `Stop` hooks that inject workflow state, entry
  contracts, and session memory. They never block, never throw, and never make network calls.
- Local session memory with prose compression that preserves code spans, paths, URLs,
  filenames, and version numbers byte-for-byte, and strips `<private>…</private>` before
  writing to disk.
- Optional `goat-runtime` Rust binary (no external crates) for the `SessionStart` and
  `Stop` fast path, with automatic fallback to the Node handler.

**Packaging**

- npm package with a `goat` binary; Codex plugin manifest at `.codex-plugin/plugin.json`;
  optional Bun single-file build.
- 66 unit tests, 74 bundle contract checks, 17 Rust tests.

[0.1.0]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.0
