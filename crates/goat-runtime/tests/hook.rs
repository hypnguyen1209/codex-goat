//! Behavioral tests for the native hook path.
//!
//! The invariants here are the ones that protect a user's session: never block, never
//! panic on garbage input, and hand `UserPromptSubmit` back to Node rather than
//! duplicating the stage table.

use std::fs;
use std::path::{Path, PathBuf};

use goat_runtime::hook::{handle, HookOutcome};

/// Each test gets its own `GOAT_ROOT`. `std::env::set_var` is process-wide, so these
/// tests share one root name per test via a unique directory instead of mutating env
/// per-case in parallel.
fn sandbox(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("goat-runtime-test-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".goat").join("state")).expect("create sandbox");
    dir
}

fn payload(event: &str, cwd: &Path, extra: &str) -> String {
    let cwd_json = json_escape(&cwd.display().to_string());
    format!(r#"{{"hook_event_name":"{event}","session_id":"s1","cwd":{cwd_json}{extra}}}"#)
}

fn json_escape(value: &str) -> String {
    goat_runtime::json::escape(value)
}

#[test]
fn user_prompt_submit_is_delegated_to_node() {
    let dir = sandbox("delegate");
    let outcome = handle(
        &payload("UserPromptSubmit", &dir, r#","prompt":"$plan x""#),
        "2026-01-01T00:00:00.000Z",
    );
    assert_eq!(outcome, HookOutcome::Delegate);
}

#[test]
fn garbage_input_produces_an_empty_response() {
    assert_eq!(
        handle("not json", "2026-01-01T00:00:00.000Z"),
        HookOutcome::Handled("{}".to_string())
    );
    assert_eq!(
        handle("", "2026-01-01T00:00:00.000Z"),
        HookOutcome::Handled("{}".to_string())
    );
}

#[test]
fn unknown_events_produce_an_empty_response() {
    let dir = sandbox("unknown");
    assert_eq!(
        handle(&payload("PreToolUse", &dir, ""), "t"),
        HookOutcome::Handled("{}".to_string())
    );
}

#[test]
fn session_start_without_state_produces_no_context() {
    let dir = sandbox("empty-session");
    assert_eq!(
        handle(&payload("SessionStart", &dir, ""), "t"),
        HookOutcome::Handled("{}".to_string())
    );
}

#[test]
fn session_start_surfaces_objective_and_missing_evidence() {
    let dir = sandbox("session-context");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        r#"{"objective":"ship checkout fix","stages":{"plan":{"status":"active","artifact":".goat/plans/x.md","evidence":[]},"ultragoal":{"status":"complete","evidence":[]}}}"#,
    )
    .expect("write state");

    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "t") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(response.contains("ship checkout fix"), "objective missing: {response}");
    assert!(
        response.contains("$plan: active"),
        "in-flight stage missing: {response}"
    );
    assert!(
        response.contains("UNPROVEN — no evidence recorded"),
        "unproven claim not flagged: {response}"
    );
    assert!(response.contains("\"hookEventName\":\"SessionStart\""));
}

#[test]
fn stop_records_the_last_assistant_message_as_memory() {
    let dir = sandbox("stop-memory");
    let outcome = handle(
        &payload(
            "Stop",
            &dir,
            r#","last_assistant_message":"I will basically fix ./src/a.ts now""#,
        ),
        "2026-01-01T00:00:00.000Z",
    );
    assert_eq!(outcome, HookOutcome::Handled("{}".to_string()));

    let memory = fs::read_to_string(dir.join(".goat").join("memory").join("observations.jsonl")).expect("memory file");
    // The path keeps its leading space: a recorded command has to stay runnable.
    assert!(memory.contains("fix ./src/a.ts"), "path was damaged: {memory}");
    assert!(
        !memory.to_lowercase().contains("basically"),
        "adverbial filler kept: {memory}"
    );
    // "I will" survives on purpose — see FILLER in compress.rs.
    assert!(memory.contains("I will"), "subject-verb opener was stripped: {memory}");
}

#[test]
fn a_response_never_carries_a_block_decision() {
    let dir = sandbox("no-block");
    for event in ["SessionStart", "Stop", "PreToolUse"] {
        if let HookOutcome::Handled(response) = handle(&payload(event, &dir, ""), "t") {
            assert!(
                !response.contains("\"decision\""),
                "{event} emitted a decision: {response}"
            );
        }
    }
}

/// The native and Node paths must agree on which claims are backed, or a resumed session
/// reports a stage as proven that `goat status` reports as unproven.
#[test]
fn session_start_rejects_failing_and_no_op_evidence() {
    let dir = sandbox("weak-evidence");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        // All three are command-proof stages: a document stage is proven by its artifact,
        // so a failing command there is not the case under test.
        r#"{"stages":{
            "ultragoal":{"status":"complete","evidence":[{"command":"npm test","exitCode":1,"at":"t"}]},
            "ultraqa":{"status":"complete","evidence":[{"command":"true","exitCode":0,"at":"t"}]},
            "team":{"status":"complete","evidence":[{"command":"npm run lint","exitCode":0,"at":"t"}]}
        }}"#,
    )
    .expect("write state");

    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "t") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(
        response.contains("every recorded command failed (last: npm test -> exit 1)"),
        "a failing command was accepted as proof: {response}"
    );
    assert!(
        response.contains("every recorded command is a shell no-op"),
        "a shell no-op was accepted as proof: {response}"
    );
    assert!(
        response.contains("$team: complete, 1 evidence entr(ies)"),
        "a real passing command was not accepted: {response}"
    );
}

/// The native path must classify proof exactly as `goat status` does, or a resumed
/// session and the CLI disagree about which claims are backed.
#[test]
fn session_start_matches_the_proof_model() {
    let dir = sandbox("proof-model");
    fs::write(dir.join("plan.md"), "# plan").expect("write artifact");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        r#"{"stages":{
            "plan":{"status":"complete","artifact":"plan.md","evidence":[]},
            "clarify":{"status":"complete","artifact":".goat/plans/ghost.md","evidence":[]},
            "ultragoal":{"status":"complete","artifact":"plan.md","evidence":[]}
        }}"#,
    )
    .expect("write state");

    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "t") else {
        panic!("SessionStart must be handled natively");
    };
    // A document stage with its artifact on disk is proven, with no command at all.
    assert!(
        response.contains("$plan: complete, 0 evidence entr(ies)"),
        "document stage was not accepted: {response}"
    );
    // A recorded artifact that was never written is never proof.
    assert!(
        response.contains("artifact recorded but missing on disk: .goat/plans/ghost.md"),
        "ghost artifact accepted: {response}"
    );
    // An execution stage still needs a command, artifact or not.
    assert!(
        response.contains("$ultragoal: complete, UNPROVEN — no evidence recorded"),
        "execution stage was accepted without a command: {response}"
    );
}
