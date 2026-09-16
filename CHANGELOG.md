# Changelog

All notable changes to codex-goat are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] — 2026-09-16

Found by studying [ponytail](https://github.com/DietrichGebert/ponytail)'s hook runtime and install scripts, and [codex-astra-luna-orchestrator](https://github.com/donvito/codex-astra-luna-orchestrator)'s sub-agent configuration. Every item was reproduced against the shipped build before it was fixed.

### Fixed

- **`$team` gave the model instructions that are false in the commonest session.** "Spawn at most six open at once" and "a finished lane holds its slot until you `close_agent` it" are multi-agent V1 facts. Codex's catalog default is `gpt-6-astra`, which runs V2, where `close_agent` is not registered at all, the cap is lower, and a finished lane is reclaimed automatically — so a plain `goat` session was told to wait for slots already freed and to call a tool it does not have. Both instructions are now conditional on what the session's tool set actually offers, and the skill reads the concurrency budget out of the prompt Codex already provides. A bundle check keeps it from drifting back.
- **The hook checks added earlier in this release were vacuous on an empty hooks file.** Iterating an empty list passes every assertion inside it, and `[].every(...)` is `true`, so a `hooks.json` with no handlers would have sailed through the timeout and `PLUGIN_ROOT` guards — the same defect class as the exit code that was stored but never compared. Both guards now assert their population first, and the suite pins its own check count so a check that stops running fails the build instead of shrinking the total.
- **`goat uninstall` deleted a `hooks.json` it could not parse, and `goat setup` rewrote one.** Both destroyed hooks belonging to other tools, and uninstall reported it as "contained only goat hooks". The cause was shared: `readJson(file, null)` cannot tell "absent" from "unreadable". A new `readJsonFile` returns `missing | invalid | ok`, and both callers now refuse to write to a file they cannot read, naming the file and the parse error.
- **`goat doctor` reported trusted hooks as untrusted on Windows.** Codex writes a user-scope trust key as a TOML *literal* string (`[hooks.state.'C:\Users\…\hooks.json:session_start:0:0']`) because the path is full of backslashes, while plugin keys come out double-quoted. The parser matched only the double-quoted form, so every Windows user was told their hooks would be silently skipped when Codex was running them.
- **A changed hook definition silently invalidates Codex's trust approval, and goat now says so.** Codex hashes the normalized handler — command, matcher, timeout, `async`, `statusMessage` — and only `Trusted` or `Managed` handlers ever run; a changed one becomes `Modified` and is dropped without a word. Adding a timeout below is exactly such a change. `goat setup` now reports which definitions changed and tells you to re-approve in `/hooks`, and because npm buffers a lifecycle script's stderr, that notice is threaded into the postinstall report that prints to stdout and into the first-launch message. `goat doctor` no longer claims "trusted": it says trust records are present and that it checks their existence, not that their hash still matches.
- **Every hook declares `timeout: 10`.** Codex defaults an omitted timeout to **600 seconds** (`timeout_sec.unwrap_or(600)`), so a hung goat hook would have held the turn for ten minutes. This affects the two synchronous hooks; `Stop` already declared 15. Ten seconds is generous for local file reads plus one `git status` that caps itself at five, and a timed-out hook only loses its injected context. A bundle check pins it.
- **Both runtimes strip a leading byte-order mark before parsing JSON.** A `.goat/config.json` saved by a Windows editor was silently ignored, so `memory.enabled: false` did nothing.

### Changed

- **`routing.ts` and the README now state the one exception to "a session runs one model".** A `$team` lane is a separate Codex thread whose model and effort are seeded from the session that spawned it, so lanes inherit the root's model rather than the stage's route. `goat --for team` is the simple way to keep them cheap. Codex's `agents.default_subagent_model` can retarget spawns for no token cost, but setting it alone resets effort to that model's catalog default; both keys are documented together and goat writes neither, since they would change every spawn in every session rather than just a lane.
- **`goat roles install`'s cost is stated correctly.** It is a step, not a slope: with no roles Codex removes `agent_type` from the spawn schema entirely, so installing one brings the property back carrying Codex's own `default`, `explorer` and `worker` alongside yours. The source comment also records why a generated role never pins `model` — Codex applies the role layer after the spawn arguments, so a pin beats even an explicit model the caller passed.
- Five stale test counts in the README now match what the commands print: 175 unit, 102 bundle contract, 29 Rust.

**Upgrading:** this release changes the two synchronous hook definitions, so Codex will treat any approval you already gave them as stale. Re-approve in the Codex TUI with `/hooks` after upgrading, or `goat doctor` will show them as not trusted.

## [0.1.7] — 2026-09-15

### Changed

- **`goat` runs Codex in yolo mode by default.** No approval prompts and no sandbox: `-c approval_policy="never" -c sandbox_mode="danger-full-access"`, the two overrides Codex's own `--yolo` flag sets. A wrapper whose job is to let Codex finish work should not stop it to ask; `--madmax` used to opt into exactly this and now merely restates the default. It is injected as config overrides rather than the flag so `--print-argv` shows it and anything explicit wins: `-s`/`--sandbox`, `-a`/`--ask-for-approval`, `--full-auto`, `--yolo`, or your own `-c` for either key suppresses the matching default, wherever in the command line it appears. `--safe` keeps Codex's own approval and sandbox defaults; `--no-goat-defaults` still injects nothing. `goat exec` gets the same default, with explicit flags after `--` respected the same way.

## [0.1.6] — 2026-09-15

Two decisions taken after re-auditing the Codex source at v0.155.0-alpha (1,803 commits past the 0.147.0 that was installed here). Both are implemented version-aware, because the Codex that ships them is newer than the one most installs have today.

### Changed

- **`$clarify`, `$plan` and `$code-review` route to `gpt-6-astra`.** Codex's catalog now ranks Astra priority 1, which makes it the default for a fresh install; sol moved to 6, terra 7, luna 8. Astra's entry carries `minimal_client_version = 0.153.0` and the server refuses it to older clients, so the route carries the same gate: `goat` reads `codex --version` once, launches `gpt-5.6-sol` below 0.153.0, and says so in the launch notes. `goat doctor` lists which routes are gated on your install, and `goat skills` shows the fallback next to each route. `GOAT_CODEX_VERSION` overrides the probe. Astra has not been benchmarked here; the README says so.
- **goat's own `--worktree` is retired; the flag is forwarded to Codex.** Codex grew managed worktrees (`--worktree`, a boolean, checkouts under `~/.codex/worktrees`, on by default), so goat's `../<repo>.goat-worktrees/<name>` implementation was a second, incompatible one under the same flag — and `goat exec --worktree --ephemeral` had started to hard-fail because Codex rejects that pair. `--worktree` now reaches Codex untouched. **Breaking:** `--worktree=<name>` and `-w <name>` are no longer accepted by goat; Codex's flag takes no name. Codex accepts `--worktree` from 0.155.0, and goat's launch notes warn when the installed Codex predates it. Existing `.goat-worktrees` checkouts are untouched; remove them with `git worktree remove` when done.

### Fixed

- `routing.ts`, the README and this changelog claimed Codex ranks sol at priority 0 and luna at 2. The catalog says 6 and 8, with Astra at 1. The rationale now cites the file it comes from.
- **`goat doctor` now detects whether Codex will actually run the hooks.** Codex runs a user- or project-layer hook only after the user trusts it, records that trust in `config.toml` as `[hooks.state."<path>:<event>:<group>:<handler>"]`, and drops untrusted hooks silently; `codex exec` never prompts. On the machine this was found on, goat's hooks had been registered and inert since install, including through the README benchmark's TUI runs. Doctor now computes the same keys Codex does, reads the trust records, and names the handlers that will not run. It never writes trust: the hash covers the handler's exact definition and the prompt exists so a user sees what will run.
- **Proof is content-level.** A zero-byte artifact closed `$plan` green (`: > plan.md`, then `--artifact plan.md`); a corrupt `state.json` made every stage report idle with exit 0 and doctor pass. Both runtimes now report an empty artifact as unproven, `goat status` warns and exits non-zero when the state file cannot be parsed, and doctor has a state-file check. The hook still stays quiet on a corrupt file, as it must.
- **Forked sessions are rehydrated.** Codex 0.155 added `fork` as a SessionStart source; goat's exact-match list omitted it, so a forked thread started with none of the parent's workflow state. On older Codex the extra alternative is simply never matched.
- **In-flight stages carry their failures across a restart.** SessionStart printed an active stage as status plus artifact only, so three recorded `npm test -> exit 1` runs resumed as zero and the three-failures rule in AGENTS.md started over. Both runtimes now append the failing-command count and the last failure.
- **`--effort max` and `--effort ultra` were silently turned into `high`.** The launcher accepted only four levels; Codex's vocabulary has seven. Every level now passes through, and an unknown one is an error instead of a quiet substitution.
- `memory.enabled` and `memory.digestSize` in `.goat/config.json`, written by `goat setup` since 0.1.0, were never read by either runtime. Both honour them now, and `GOAT_MEMORY=off` wins over the file.
- `scripts/catalog-probe.mjs` tested for "Use when" while `$ultragoal` opens "Use for", so it reported the fixed skill as trigger-less. The bundle check also assumed a flat 119-character window; the real per-skill window is cost-based (name and path are charged first), so it now requires the trigger at offset 0.

### Changed

- **SessionStart says how old the rehydrated state is.** One line, only when something was rehydrated; past seven days it asks for confirmation before AGENTS.md's "resume from the first unfinished item" applies.
- **`.goat/SESSION.md` is documented and capped.** It was read and injected by both runtimes and written by nothing, mentioned nowhere. It is now the place for notes the next session must not re-derive, injected up to 4,000 characters with a pointer to the file, under Codex's 2,500-token hook-output spill limit.
- The Stop hook runs `async` and SessionStart carries a `statusMessage`. Stop only records an observation and never emits a decision, so nothing waits on it. Both fields were already parsed by Codex 0.147.0.
- `$code-review` gains an **Omission** dimension: what the diff implies but does not contain — a mirrored runtime left unsynced, a doc row that now lies, a sibling script's regex. Refuting findings catches false positives; this is the row that hunts false negatives.
- `$ultraqa` names the borrowed-environment cheat: a green run against a `node_modules` or build directory copied in from elsewhere is not a baseline.
- Benchmark results record `goatVersion`, `goatCommit` and `goatDirty` next to `codexVersion`, so a result generated before a release that rewrote every description can no longer pass as current.

### Added

- **`$team` runs lanes as Codex sub-agents.** Codex's `spawn_agent` tool tells the model not to spawn unless a skill or the user explicitly asks for delegation, and the skill never did — it promised concurrency in its description and prescribed a serial loop in its body. It now asks in so many words: one sub-agent per lane, started fresh with the lane's own brief, at most what the tool allows open at once, `wait_agent` until every lane has returned (with several ids it returns on the first finisher), and `close_agent` once a lane's evidence is recorded, because a finished lane holds its slot until closed. Lanes are told not to write the ledger; the root re-runs each lane's verify command itself and records the exit code it observed, because `updateStage` is an unlocked read-modify-write of one file and two lanes finishing together lose proof, and because a code copied from a lane's report is a claim the root never saw. Without `spawn_agent` the lanes run serially under the same rules, so the stage still holds. Validated live on Codex 0.147.0 with `gpt-5.6-luna` at medium effort: a three-lane request produced three `spawn_agent` calls with one lane brief each, three `wait` calls, three lane evidence entries and one merged entry written by the root, and a `complete` close; no lane touched the ledger. The hook ignores a `UserPromptSubmit` that carries an `agent_id`: a lane brief is not a prompt to remember, and a `$stage` sigil inside one must not attach a contract report to a lane. Three bundle checks pin the request, the single-writer rule, and the serial fallback.
- **`$ultragoal` registers a native Codex goal** when the session offers `create_goal`, and closes it with `update_goal` alongside `goat state set`. Codex then re-prompts while the goal is active, audits completion, and asks the model to mark the goal blocked once the same obstacle has held for three consecutive turns — a per-turn cousin of goat's three-failures rule, not the same rule, so the skill says to stop and report after three failed attempts but leave the goal active until Codex's own threshold is met. An already-active goal is left alone. The goal is thread-bound (it returns on `codex resume`, a new session never sees it); the goals file and the ledger remain the durable record and the proof.
- **`goat roles install|uninstall|list`** ships the nine role cards as Codex agent roles, `<config>/agents/<role>.toml` with `name`, `description` and `developer_instructions`, so each becomes an `agent_type` for `spawn_agent`. Opt-in: every role costs schema tokens on every turn. Files goat did not generate are never overwritten or removed. Codex has discovered role files since 0.115.0 (the loader moved into its own crate in 0.150.0); the command and `goat doctor` warn on an older CLI, and both note that project-scope roles load only in a project Codex trusts.
- **`npm install -g codex-goat` is now the whole install.** Until now the package shipped the CLI, the skills, the hooks and the Rust *source*, but not the native runtime, and ran no setup: a user needed three steps, one of them a manual download from the release page. A `postinstall` now fetches the prebuilt `goat-runtime` for the platform from the matching GitHub release, verifies it against `checksums.txt`, smoke-tests it, and installs it where the hook already looks; then, for a global install on a real user's machine, runs the user-scope setup. Every step is best-effort and reports a reason instead of failing the install: unsupported platform, no release yet for this version, offline, `sudo` (HOME would be root's), CI, a project-dependency install, or a development checkout. `GOAT_SKIP_POSTINSTALL`, `GOAT_SKIP_NATIVE` and `GOAT_SKIP_SETUP` opt out. Because npm hides lifecycle output by default, the outcome is written to `bin/.postinstall.json` and `goat doctor` reports it. As a second net, the first real `goat` launch runs the user-scope setup when it is missing and fetches the native runtime once per version, so `--ignore-scripts`, package managers that skip lifecycle scripts, and npm's `install-scripts` gating (a warning today, possibly a block tomorrow) still end up with one command. Verified by packing the tarball and installing it into a throwaway global prefix: postinstall ran on npm 11.19 and reported correctly; under `--ignore-scripts` the first launch fetched, recorded the attempt, and did not retry. Releases now publish a raw binary per platform beside each archive so the fetcher needs no tar or zip parser.

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
