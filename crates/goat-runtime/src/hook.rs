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

/// Stage ids, in the order `src/state/stages.ts` declares them.
const STAGES: &[(&str, &str)] = &[
    ("clarify", "$clarify"),
    ("plan", "$plan"),
    ("ultragoal", "$ultragoal"),
    ("team", "$team"),
    ("code-review", "$code-review"),
    ("ultraqa", "$ultraqa"),
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

        for (id, invocation) in STAGES {
            let Some(stage) = doc.get("stages").and_then(|stages| stages.get(id)) else {
                continue;
            };
            let status = stage.get("status").and_then(Json::as_str).unwrap_or("idle");
            let artifact = stage.get("artifact").and_then(Json::as_str).unwrap_or_default();
            let evidence = stage
                .get("evidence")
                .and_then(Json::as_array)
                .map(Vec::len)
                .unwrap_or(0);

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
                    let proof = if evidence > 0 {
                        format!("{evidence} evidence entr(ies)")
                    } else {
                        "NO EVIDENCE RECORDED".to_string()
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
