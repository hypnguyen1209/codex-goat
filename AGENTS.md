# Contributing to codex-goat

Rules for anyone — human or agent — changing this repository.

## What this project is

A wrapper and plugin around OpenAI Codex CLI. Codex stays the execution engine.

- Do **not** fork, vendor, or patch Codex source.
- Do **not** invent Codex config keys, hook events, or manifest fields. Verify against the Codex source before using one. Getting this wrong produces a config Codex silently ignores, which is worse than an error.
- Every launch behavior must be visible through `goat --print-argv`. A wrapper that quietly changes what runs is worse than no wrapper.

## Non-negotiable invariants

These are enforced by tests. If you change one, change the test deliberately and say why.

1. **No stage is ever hard-blocked.** `RequirementVerdict` is `satisfied | inline` and nothing else. A third verdict would make a stage blockable and end independent invocation. — `src/__tests__/contract.test.ts`, plus a bundle check that fails if the union grows. v0.1.0 declared a `"missing"` case nothing produced, which made the readiness filter a tautology; the type is the enforcement, not the comment.

2. **Evidence must back the claim.** `isSubstantiveEvidence` rejects a non-zero exit code, an empty command, and shell no-ops. v0.1.0 stored `exitCode` and never compared it, so a failing test satisfied the gate. Both the Node and native hook paths use the same predicate and their no-op lists are checked against each other. — `src/__tests__/state.test.ts`, `crates/goat-runtime/tests/hook.rs`
3. **Hooks never block, never throw, never phone home.** Malformed input exits 0 with `{}`. No hook response contains a `decision` field. The one subprocess is a bounded `git status` on an explicit stage invocation, and it is documented as such rather than denied. — `src/__tests__/handler.test.ts`, `crates/goat-runtime/tests/hook.rs`
4. **Setup and uninstall touch only what goat owns.** Foreign `hooks.json` entries and all AGENTS.md content outside the markers survive both. The exception is a top-level key Codex would reject: `hooks.json` is parsed with `deny_unknown_fields`, so preserving an unknown key would disable every hook in the file. Those are dropped and named. — `src/__tests__/hooks-file.test.ts`, `src/__tests__/agents-md.test.ts`
5. **The two compressors agree.** `src/state/memory.ts` and `crates/goat-runtime/src/compress.rs` are checked against one shared fixture. Session memory must not depend on whether the native binary was built.
6. **`.goat/` is never deleted implicitly.** `uninstall` keeps it unless `--purge-state`.
7. **What ships must actually run.** Every runtime import in `hooks/goat-hook.mjs` has to be carried by the install channel the marketplace declares. v0.1.1 shipped a plugin whose hooks imported an untracked `dist/`, so they emitted `{}` forever. — `scripts/verify-bundle.mjs`

## The stage table has one source of truth

`src/state/stages.ts` defines the stages. Adding one means, in the same change:

1. Add it to `STAGE_IDS` and `STAGES`.
2. Create `skills/<id>/SKILL.md` — `name` must equal the directory name.
3. Update `STAGES` in `crates/goat-runtime/src/hook.rs`, which mirrors the id list.
4. Add its routing row to `skills/goat-workflow/SKILL.md`.

`npm run test:contract` fails on steps 1–2 being out of sync. Steps 3–4 are on you.

## Skills

- Frontmatter needs `name` (matching the directory) and `description`.
- The description is what Codex routes on. Write when to use it and the words a user would actually type, in 40–500 characters.
- Every skill must contain the string `codex-goat` — that is how setup and uninstall identify ownership.
- Skills are prose contracts, not code. State the entry contract, the method, the evidence requirement, and the handoff. No filler.

## Testing

```bash
npm run verify     # lint + build + unit + contract + native
```

New behavior needs a test that fails without it. Never delete or weaken a test to get a green run; if a test is wrong, fix the test and say so in the commit message.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

The body says what changed and why. If a change was driven by a real failure, name the failure — the `--status` value-flag bug is documented in the test that now guards it, and that is the standard.

## Not committed

`docs/` is gitignored. Working specs, plans, and design notes stay local; the README and `AGENTS.md` are the documentation that ships.
