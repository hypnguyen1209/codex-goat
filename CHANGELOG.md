# Changelog

All notable changes to codex-goat are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] — 2026-09-03

An optimization audit that mostly found correctness bugs. The headline measurement is that Codex gives the whole skill catalog one character budget and splits it across every installed skill, cutting each description by prefix — so what a description is worth depends on how many *other* skills the user has, which this repo cannot see from its own files.

### Fixed

- **Every skill's routing trigger was being truncated away.** Measured with `codex debug prompt-input` on a 116-skill machine: each codex-goat description is cut to 119–124 characters, and every one of them spent that window describing what the skill *does*, with `Use when …` at the end. Not one of the eight had an intact trigger clause; `$clarify` was cut mid-word at "the questions the codebase cannot answ". Descriptions now lead with the trigger and keep the method after it, so all eight survive the cut. Nothing was shortened — `$code-review` keeps the four dimensions and "adversarially verify" that distinguish it from other review skills in the same catalog. `scripts/catalog-probe.mjs` measures a real install, and a bundle check fails a description whose trigger falls outside the window.
- **`$ultraqa`'s cleanup step deleted the file it then recorded as proof.** "Remove every temporary harness, fixture, log, spawned process, and state file the run created" covers `.goat/qa/<slug>.md`, so a QA run that did everything right reported `complete*` — and only a session later, through the SessionStart hook. Cleanup now exempts `.goat/`.
- **`$ultraqa` and `$team` closed stopped and blocked runs as `complete`.** Both list mutually exclusive verdicts — `ULTRAQA STOPPED: max cycles`, a lane that stayed blocked — and then ran one unconditional `--status complete`. Because a single passing command satisfies the gate, a half-executed matrix rendered identically to a proven one. Both now close `blocked` unless the run actually finished.
- **`AGENTS.md` stated only half the proof rule.** It said "a claim needs a command that ran" and enumerated `complete*` purely in command terms, but `$clarify`, `$plan` and `$code-review` are proven by their artifact. For half the workflow the always-on rules described a test that does not apply and invited the model to manufacture a command. The rule now states the split, including the missing-artifact case.
- `goat status | head -3` crashed with an unhandled `EPIPE`. A reader closing the pipe is ordinary use, not an error to report.

### Changed

- The entry-contract report attaches its "stages are independent" note only when a requirement is actually `inline`. On `$clarify`, which has no prerequisites, it printed under "- no prerequisites" and named both a requirement category the stage cannot have and an earlier stage that does not exist.
- `templates/AGENTS.md` drops the `.goat/` path table. Each skill already names the path it writes to, and no workflow rule lived in the table.
- `$clarify`, `$plan` and `$code-review` pin `effort: "high"` in `DEFAULT_ROUTES`. That is already the default, so nothing changes today; it is written down so a future change to the global default cannot quietly lower the three stages whose whole output is a judgement. The execution stages were deliberately **not** dropped to `medium` despite a measured −275 generated tokens per turn: that benchmark contains no `$ultragoal`, `$team` or `$ultraqa` work, and the mechanism behind codex-goat's measured savings is the model answering in one pass instead of two, which no run records at any effort but medium.

## [0.1.4] — 2026-09-03

### Added

- **`goat --for <stage>` routes a stage to a model.** A Codex session runs one model, so a stage cannot switch models mid-conversation; what makes routing work is that `.goat/` is durable. `$plan` writes an artifact, the session ends, and a new session on a different model picks it up through the same entry contract — the split is across sessions, which is what the entry-contract design was for. `$clarify`, `$plan` and `$code-review` route to `gpt-5.6-sol`; `$ultragoal`, `$team` and `$ultraqa` route to `gpt-5.6-luna`.
- **Per-project overrides in `.goat/config.json`.** A `routes` entry merges per field, so an effort can be pinned without restating the model. Explicit flags still win over both: `--for plan -m gpt-5.6-terra` keeps terra and says so in the launch notes.
- `goat skills` prints the route for every stage, and `--print-argv` shows the resolved command before anything runs.

The defaults rest on how Codex positions the models — `gpt-5.6-sol` is priority 0 and the default in its own catalog, and Codex routes its own approval review, memory extraction and guardian scoring to `gpt-5.6-luna` — plus the measurement in this repo that luna finished faster in all six model × effort cells with a 1,558-token lighter prefix. They do **not** rest on output quality, which nothing here grades; the README says so rather than implying the split is optimal.

### Fixed

- `--for` was absent from `VALUE_FLAGS` on the first pass, so it parsed as a boolean and silently injected no model — the same class of defect as the `--status` bug fixed in 0.1.1. It is now covered by the guard test that enumerates every flag the CLI reads by value.

## [0.1.3] — 2026-09-03

Prompted by an audit of [caveman](https://github.com/JuliusBrussee/caveman) for token savings. Almost none of caveman's techniques transfer — its structural compressors measure 0.0% on prose this short, and its terseness ruleset would cost more always-on tokens than it saves. The finding that mattered was that codex-goat's own compressor was buying ~4% and corrupting the record to get it.

### Fixed

- **The compressor changed what sentences asserted.** The filler list carried subject-verb openers and hedges, not just adverbials: `"let me know if you want X"` lost its verb and became `"know if you want X"`, `"I will let me down"` collapsed to `"down"`, and `"I think the fix works"` became the bare claim `"the fix works"` — turning a hedge into an assertion, which is the exact false confidence this project exists to prevent. The list now contains only adverbials that can be deleted in any position without changing meaning.
- **Recorded commands came back unrunnable.** The punctuation repair deleted the space before any dot, so `"run ./scripts/ci.sh"` was stored as `"run./scripts/ci.sh"` and `"cd .."` as `"cd.."`. The gap now closes only where the punctuation actually ends a clause. An evidence ledger is worthless if the command it recorded cannot be replayed.
- **Fenced blocks were flattened.** The final whitespace collapse ran over the joined string, reaching into protected spans, so recorded test output lost its line structure. Every transformation now happens inside an unprotected segment, and a ``` fence is matched before a single backtick.
- **The digest repeated itself.** Observations were not deduplicated: a measured mid-project session emitted eight byte-identical lines, 76% of the whole SessionStart injection saying one thing eight times. Duplicates are now dropped oldest-first, and the limit counts distinct entries.

### Changed

- Narrowing the filler list roughly halves an already-small saving. That is the intended trade: measured compression was 4.2% on realistic assistant messages, and a mangled sentence in the model's context is worse than a slightly longer one.
- Measured effect on a realistic mid-project session: the SessionStart injection went from ~512 to ~130 tokens, a 75% reduction — from deduplication, not from compressing harder.

## [0.1.2] — 2026-09-03

Five defects found by auditing codex-goat against the Codex CLI source, each confirmed against the running binary (`codex-cli 0.147.0`) or the Rust implementation before fixing.

### Fixed

- **The plugin install path shipped no code.** `git ls-files dist` returns 0, and `hooks/goat-hook.mjs` imported `dist/hooks/handler.js` inside a bare `catch {}`. A plugin installed from the marketplace's local or git source registered three hooks that ran, exited 0, and injected nothing — permanently, and with no error anywhere. The marketplace source is now npm, pinned to the exact version, because npm is the only channel that carries built code. The catch now names the missing module on stderr while still exiting 0.
- **`hooks.json` could be written in a shape Codex refuses to parse.** `HooksFile` forwarded unknown top-level keys in the name of preserving foreign content, but Codex parses the file with `deny_unknown_fields` and accepts only `description` and `hooks`. A preserved `$schema` disables every hook in the file, the user's included. Unknown keys are now dropped and named; the test that asserted the old behavior asserts the opposite.
- **The SessionStart matcher missed compaction.** `SessionStartSource` has four variants, and matchers are compared as an exact alternation list rather than a regex, so `startup|resume|clear` never matched `compact`. The session digest was not re-injected after a compaction — exactly when the model has just lost what it describes.
- **The README documented two commands that do not exist.** `/plugin marketplace add` and `/plugin install` are not Codex slash commands; installation is `codex plugin marketplace add` / `codex plugin add`. The README also claimed plugin mode delivers working hooks, and said nothing about hook trust.
- **`defaultPrompt` declared four entries against a limit of three.** The fourth was discarded with a warning no user sees.

### Changed

- `goat doctor` reports lifecycle hooks as WARN with the trust step named, instead of PASS on marker presence. A registered hook is Untrusted until approved and is skipped silently, and `codex exec` has no trust prompt at all.
- Four new bundle checks, each verified to fail when its invariant is broken: every runtime import in the hook script is carried by the declared install channel, the marketplace pins the current version, and `defaultPrompt` fits Codex's limit.

## [0.1.1] — 2026-09-03

Four defects found by reading five comparable projects (oh-my-codex, ECC, codegraph, claude-mem, ponytail) and then auditing this repo against them. All four were confirmed by running the shipped binary, and each now has a regression test.

### Fixed

- **The evidence gate accepted failing commands.** `EvidenceRef.exitCode` was stored, written to the ledger, and printed — and never compared to zero, so `goat ledger evidence --exit 1 -- npm test` satisfied the gate and `goat status` exited
  0. `isSubstantiveEvidence` now requires exit 0, a non-empty command, and rejects shell no-ops (`true`, `:`, `echo`, …). `goat status` reports which of the three failed. The no-op list is a lint against lazy proof, not a security control.
- **`goat state set` silently erased the artifact.** `flagString` returned `null` for an absent flag and `updateStage` reads `null` as "clear this field", so `goat state set --stage plan --status complete` with no `--artifact` wiped the path a previous call recorded. Absent flags are now `undefined`; `--artifact=` still clears deliberately.
- **The hook violated its own documented purity rule.** `detectStage` matched a bare leading word, so ordinary prose ("plan the migration") was treated as a stage invocation and paid for a contract report including its `git status` probe. An explicit `$` or `/` sigil is now required, and the documented invariant states the one bounded git call instead of claiming there is no subprocess.
- **`compress()` stripped at most three filler phrases.** The pass loop broke on the first hit and capped at three rounds, so a sentence with ten filler phrases kept seven. Every occurrence is now removed, earliest-match-first, with a bound proportional to input length. Both the TypeScript and Rust implementations changed together; the shared fixture proves they still agree.

### Changed

- `RequirementVerdict` narrowed to `satisfied | inline`. The `"missing"` case nothing produced made the readiness filter a tautology and hid the never-hard-block rule behind an unreachable branch. `ContractReport.ready` is now typed `true`.
- The native `SessionStart` path uses the same evidence predicate as `goat status`, so a resumed session and the CLI cannot disagree about which claims are proven.
- Three new bundle checks, each verified to fail when the invariant is broken: no dead requirement verdict, the evidence gate inspects the exit code inside its own body, and the no-op command lists match across the Node and native paths.
- CI now asserts all three evidence-gate holes fail the status gate, and that a later `state set` preserves the artifact. It previously recorded `-- true` as evidence and asserted that it passed.

## [0.1.0] — 2026-09-03

First release.

### Added

**Workflow — six stages, no fixed chain**

- `$clarify`, `$plan`, `$ultragoal`, `$team`, `$code-review`, `$ultraqa`, each with an explicit entry contract so it can be invoked on its own.
- `goat contract [<stage>]` reports, per requirement, whether it is already satisfied or can be satisfied inline from the user's own message. No requirement is ever hard-blocking.
- `$goat-workflow` routing card for choosing a stage, and `$goat-roles` indexing nine specialist role prompts.

**Evidence ledger**

- `goat ledger evidence --stage <stage> --exit <code> -- <command>` records proof.
- `goat status` reconciles claims against proof, marks any stage completed without evidence as `complete*`, and exits non-zero so CI can gate on it.
- Durable state under `.goat/`: `state/state.json`, `ledger.jsonl`, and per-stage artifact directories. State reads repair malformed files rather than throwing.

**CLI**

- `goat` launches Codex with raised reasoning effort (`high` by default), `--madmax` for the Codex sandbox bypass, and `--worktree` for isolated aggressive sessions.
- Flags codex-goat does not own are forwarded to Codex in the order they were typed.
- `--print-argv` prints the resolved, shell-quoted Codex command without side effects.
- `goat setup`, `doctor`, `exec`, `status`, `contract`, `state`, `ledger`, `skills`, `hook`, `uninstall`.
- `goat setup` merges into `AGENTS.md` between markers and into `hooks.json` by ownership, preserving foreign content in both. `goat uninstall` reverses exactly that and keeps `.goat/` unless `--purge-state` is passed.

**Runtime helpers**

- `SessionStart`, `UserPromptSubmit`, and `Stop` hooks that inject workflow state, entry contracts, and session memory. They never block, never throw, and never make network calls.
- Local session memory with prose compression that preserves code spans, paths, URLs, filenames, and version numbers byte-for-byte, and strips `<private>…</private>` before writing to disk.
- Optional `goat-runtime` Rust binary (no external crates) for the `SessionStart` and `Stop` fast path, with automatic fallback to the Node handler.

**Packaging**

- npm package with a `goat` binary; Codex plugin manifest at `.codex-plugin/plugin.json`; optional Bun single-file build.
- 66 unit tests, 74 bundle contract checks, 17 Rust tests.

[0.1.4]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.4
[0.1.3]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.3
[0.1.2]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.2
[0.1.1]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.1
[0.1.0]: https://github.com/hypnguyen1209/codex-goat/releases/tag/v0.1.0
