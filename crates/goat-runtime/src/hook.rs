//! The native fast path for Codex lifecycle hooks.
//!
//! Scope is deliberately narrow. `SessionStart` and `Stop` need only `.goat/` state and
//! the memory log, so they are handled here in a few milliseconds. `UserPromptSubmit`
//! needs entry-contract evaluation (including `git status`), whose single source of truth
//! is the TypeScript stage table — so this binary declines it with
//! [`HookOutcome::Delegate`] and `hooks/goat-hook.mjs` falls back to Node.
//!
//! Duplicating the stage table here would create exactly the drift this split avoids.

use std::path::{Path, PathBuf};

use crate::json::{self, Json};
use crate::state;

#[derive(Debug, PartialEq)]
pub enum HookOutcome {
    /// A complete hook response, ready to write to stdout.
    Handled(String),
    /// This event belongs to the Node handler.
    Delegate,
}

pub fn handle(raw: &str, now: &str) -> HookOutcome {
    let Ok(input) = json::parse(raw) else {
        return HookOutcome::Handled("{}".to_string());
    };

    let event = input.get("hook_event_name").and_then(Json::as_str).unwrap_or_default();
    let cwd: PathBuf = match input.get("cwd").and_then(Json::as_str) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    };
    let session_id = input.get("session_id").and_then(Json::as_str).unwrap_or("unknown");

    match event {
        "SessionStart" => HookOutcome::Handled(match session_start_context(&cwd) {
            Some(context) => additional_context("SessionStart", &context),
            None => "{}".to_string(),
        }),
        "Stop" => {
            if let Some(message) = input.get("last_assistant_message").and_then(Json::as_str) {
                if !message.is_empty() {
                    state::record_observation(&cwd, session_id, "result", message, now);
                }
            }
            HookOutcome::Handled("{}".to_string())
        }
        "UserPromptSubmit" => HookOutcome::Delegate,
        _ => HookOutcome::Handled("{}".to_string()),
    }
}

fn additional_context(event: &str, context: &str) -> String {
    format!(
        "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
        json::escape(event),
        json::escape(context)
    )
}

/// Shell no-ops that exit 0 without checking anything.
///
/// Mirrors `NO_OP_COMMANDS` in `src/state/store.ts`. A lint against lazy proof, not a
/// security control.
const NO_OP_COMMANDS: &[&str] = &["true", ":", "echo", "printf", "exit", "cd", "sleep", "noop"];

/// Does one recorded command actually back a completion claim?
///
/// Mirrors `isSubstantiveEvidence` in `src/state/store.ts`. A resumed session and
/// `goat status` must never disagree about which claims are proven.
fn is_substantive(entry: &Json) -> bool {
    let exit_code = match entry.get("exitCode") {
        Some(Json::Number(code)) => *code,
        _ => return false,
    };
    if exit_code != 0.0 {
        return false;
    }
    let command = entry.get("command").and_then(Json::as_str).unwrap_or_default().trim();
    if command.is_empty() {
        return false;
    }
    let first_token = command.split_whitespace().next().unwrap_or_default();
    !NO_OP_COMMANDS.contains(&first_token)
}

/// Why a completed stage's evidence does not back its claim, or `None` when it does.
///
/// Mirrors `unprovenReason` in `src/state/store.ts`.
fn unproven_reason(evidence: Option<&Vec<Json>>, proof: &str, artifact: &str, root: &Path) -> Option<String> {
    // A recorded artifact that is not on disk is not proof, whatever the stage kind.
    if !artifact.is_empty() && !root.join(artifact).exists() {
        return Some(format!("artifact recorded but missing on disk: {artifact}"));
    }

    let entries = match evidence {
        Some(entries) if !entries.is_empty() => entries,
        _ => {
            return if proof == "artifact" {
                if artifact.is_empty() {
                    Some("no artifact recorded".to_string())
                } else {
                    None
                }
            } else {
                Some("no evidence recorded".to_string())
            };
        }
    };
    if entries.iter().any(is_substantive) {
        return None;
    }
    if proof == "artifact" {
        return if artifact.is_empty() {
            Some("no artifact recorded".to_string())
        } else {
            None
        };
    }

    let failing: Vec<&Json> = entries
        .iter()
        .filter(|entry| !matches!(entry.get("exitCode"), Some(Json::Number(code)) if *code == 0.0))
        .collect();

    if failing.len() == entries.len() {
        let last = failing.last();
        let command = last
            .and_then(|entry| entry.get("command"))
            .and_then(Json::as_str)
            .unwrap_or_default();
        let code = match last.and_then(|entry| entry.get("exitCode")) {
            Some(Json::Number(code)) => *code as i64,
            _ => 0,
        };
        return Some(format!(
            "every recorded command failed (last: {command} -> exit {code})"
        ));
    }
    Some("every recorded command is a shell no-op".to_string())
}

/// Stage ids with their invocation and proof kind, mirroring `src/state/stages.ts`.
///
/// `"artifact"` stages produce a document and are proven by it existing; `"command"`
/// stages assert behaviour works and need a recorded command that exited 0.
const STAGES: &[(&str, &str, &str)] = &[
    ("clarify", "$clarify", "artifact"),
    ("plan", "$plan", "artifact"),
    ("ultragoal", "$ultragoal", "command"),
    ("team", "$team", "command"),
    ("code-review", "$code-review", "artifact"),
    ("ultraqa", "$ultraqa", "command"),
];

fn session_start_context(cwd: &Path) -> Option<String> {
    let mut blocks: Vec<String> = Vec::new();

    if let Some(doc) = state::read_state(cwd) {
        if let Some(objective) = doc.get("objective").and_then(Json::as_str) {
            if !objective.is_empty() {
                blocks.push(format!("Active codex-goat objective: {objective}"));
            }
        }

        let mut in_flight: Vec<String> = Vec::new();
        let mut complete: Vec<String> = Vec::new();

        let root = state::find_project_root(cwd);
        for (id, invocation, proof) in STAGES {
            let Some(stage) = doc.get("stages").and_then(|stages| stages.get(id)) else {
                continue;
            };
            let status = stage.get("status").and_then(Json::as_str).unwrap_or("idle");
            let artifact = stage.get("artifact").and_then(Json::as_str).unwrap_or_default();
            let evidence = stage.get("evidence").and_then(Json::as_array);

            match status {
                "active" | "blocked" => {
                    let suffix = if artifact.is_empty() {
                        String::new()
                    } else {
                        format!(" ({artifact})")
                    };
                    in_flight.push(format!("- {invocation}: {status}{suffix}"));
                }
                "complete" => {
                    let proof = match unproven_reason(evidence, proof, artifact, &root) {
                        None => format!("{} evidence entr(ies)", evidence.map(Vec::len).unwrap_or(0)),
                        Some(reason) => format!("UNPROVEN — {reason}"),
                    };
                    complete.push(format!("- {invocation}: complete, {proof}"));
                }
                _ => {}
            }
        }

        if !in_flight.is_empty() {
            blocks.push(format!("Stages in flight:\n{}", in_flight.join("\n")));
        }
        if !complete.is_empty() {
            blocks.push(format!("Stages already complete:\n{}", complete.join("\n")));
        }
    }

    if let Some(digest) = state::memory_digest(cwd, 8) {
        blocks.push(digest);
    }

    if let Ok(guidance) = std::fs::read_to_string(state::find_project_root(cwd).join(".goat").join("SESSION.md")) {
        let trimmed = guidance.trim();
        if !trimmed.is_empty() {
            blocks.push(trimmed.to_string());
        }
    }

    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n\n"))
    }
}
