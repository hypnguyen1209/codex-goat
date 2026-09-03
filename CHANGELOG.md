# Changelog

All notable changes to codex-goat are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-09-03

Five defects found by auditing codex-goat against the Codex CLI source, each confirmed
against the running binary (`codex-cli 0.147.0`) or the Rust implementation before fixing.

### Fixed

- **The plugin install path shipped no code.** `git ls-files dist` returns 0, and
  `hooks/goat-hook.mjs` imported `dist/hooks/handler.js` inside a bare `catch {}`. A plugin
  installed from the marketplace's local or git source registered three hooks that ran,
  exited 0, and injected nothing — permanently, and with no error anywhere. The marketplace
  source is now npm, pinned to the exact version, because npm is the only channel that
  carries built code. The catch now names the missing module on stderr while still exiting 0.
- **`hooks.json` could be written in a shape Codex refuses to parse.** `HooksFile` forwarded
  unknown top-level keys in the name of preserving foreign content, but Codex parses the
  file with `deny_unknown_fields` and accepts only `description` and `hooks`. A preserved
  `$schema` disables every hook in the file, the user's included. Unknown keys are now
  dropped and named; the test that asserted the old behavior asserts the opposite.
- **The SessionStart matcher missed compaction.** `SessionStartSource` has four variants,
  and matchers are compared as an exact alternation list rather than a regex, so
  `startup|resume|clear` never matched `compact`. The session digest was not re-injected
  after a compaction — exactly when the model has just lost what it describes.
- **The README documented two commands that do not exist.** `/plugin marketplace add` and
  `/plugin install` are not Codex slash commands; installation is `codex plugin marketplace
  add` / `codex plugin add`. The README also claimed plugin mode delivers working hooks, and
  said nothing about hook trust.
- **`defaultPrompt` declared four entries against a limit of three.** The fourth was
  discarded with a warning no user sees.

### Changed

- `goat doctor` reports lifecycle hooks as WARN with the trust step named, instead of PASS
  on marker presence. A registered hook is Untrusted until approved and is skipped
  silently, and `codex exec` has no trust prompt at all.
- Four new bundle checks, each verified to fail when its invariant is broken: every runtime
  import in the hook script is carried by the declared install channel, the marketplace pins
  the current version, and `defaultPrompt` fits Codex's limit.

## [0.1.1] — 2026-09-03

Four defects found by reading five comparable projects (oh-my-codex, ECC, codegraph,
claude-mem, ponytail) and then auditing this repo against them. All four were confirmed by
running the shipped binary, and each now has a regression test.

### Fixed

- **The evidence gate accepted failing commands.** `EvidenceRef.exitCode` was stored,
  written to the ledger, and printed — and never compared to zero, so
  `goat ledger evidence --exit 1 -- npm test` satisfied the gate and `goat status` exited
  0. `isSubstantiveEvidence` now requires exit 0, a non-empty command, and rejects shell
  no-ops (`true`, `:`, `echo`, …). `goat status` reports which of the three failed. The
  no-op list is a lint against lazy proof, not a security control.
- **`goat state set` silently erased the artifact.** `flagString` returned `null` for an
  absent flag and `updateStage` reads `null` as "clear this field", so
  `goat state set --stage plan --status complete` with no `--artifact` wiped the path a
  previous call recorded. Absent flags are now `undefined`; `--artifact=` still clears
  deliberately.
- **The hook violated its own documented purity rule.** `detectStage` matched a bare
  leading word, so ordinary prose ("plan the migration") was treated as a stage invocation
  and paid for a contract report including its `git status` probe. An explicit `$` or `/`
  sigil is now required, and the documented invariant states the one bounded git call
  instead of claiming there is no subprocess.
- **`compress()` stripped at most three filler phrases.** The pass loop broke on the first
  hit and capped at three rounds, so a sentence with ten filler phrases kept seven. Every
  occurrence is now removed, earliest-match-first, with a bound proportional to input
  length. Both the TypeScript and Rust implementations changed together; the shared
  fixture proves they still agree.

### Changed

- `RequirementVerdict` narrowed to `satisfied | inline`. The `"missing"` case nothing
  produced made the readiness filter a tautology and hid the never-hard-block rule behind
  an unreachable branch. `ContractReport.ready` is now typed `true`.
- The native `SessionStart` path uses the same evidence predicate as `goat status`, so a
  resumed session and the CLI cannot disagree about which claims are proven.
- Three new bundle checks, each verified to fail when the invariant is broken: no dead
  requirement verdict, the evidence gate inspects the exit code inside its own body, and
  the no-op command lists match across the Node and native paths.
- CI now asserts all three evidence-gate holes fail the status gate, and that a later
  `state set` preserves the artifact. It previously recorded `-- true` as evidence and
  asserted that it passed.

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

[0.1.2]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.2
[0.1.1]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.1
[0.1.0]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.0
