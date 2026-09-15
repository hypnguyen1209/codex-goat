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

/// Existence is not content: an empty artifact proves nothing. Mirrors store.ts.
#[test]
fn session_start_rejects_an_empty_artifact() {
    let dir = sandbox("empty-artifact");
    fs::write(dir.join("plan.md"), "").expect("write empty artifact");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        r#"{"stages":{"plan":{"status":"complete","artifact":"plan.md","evidence":[]}}}"#,
    )
    .expect("write state");
    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "2026-09-15T00:00:00Z") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(
        response.contains("artifact recorded but empty on disk: plan.md"),
        "empty artifact accepted: {response}"
    );
}

/// `.goat/config.json` `memory.enabled = false` must silence both recording and the digest.
#[test]
fn memory_config_disables_recording_and_the_digest() {
    let dir = sandbox("memory-off");
    fs::write(dir.join(".goat").join("config.json"), r#"{"memory":{"enabled":false}}"#).expect("write config");
    let outcome = handle(
        &payload("Stop", &dir, r#","last_assistant_message":"remember this""#),
        "2026-09-15T00:00:00Z",
    );
    assert_eq!(outcome, HookOutcome::Handled("{}".to_string()));
    assert!(
        !dir.join(".goat").join("memory").join("observations.jsonl").exists(),
        "an observation was recorded with memory disabled"
    );
}

/// `digestSize` bounds the digest. Three distinct observations, size 2, two lines injected.
#[test]
fn memory_config_digest_size_is_honoured() {
    let dir = sandbox("digest-size");
    fs::write(dir.join(".goat").join("config.json"), r#"{"memory":{"enabled":true,"digestSize":2}}"#).expect("write config");
    for text in ["first thing", "second thing", "third thing"] {
        handle(
            &payload("Stop", &dir, &format!(r#","last_assistant_message":"{text}""#)),
            "2026-09-15T00:00:00Z",
        );
    }
    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "2026-09-15T00:00:00Z") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(!response.contains("first thing"), "digest exceeded digestSize: {response}");
    assert!(response.contains("second thing") && response.contains("third thing"), "{response}");
}

/// A stage in flight carries its failures, so the three-failures rule survives a restart.
#[test]
fn session_start_shows_failing_commands_on_an_in_flight_stage() {
    let dir = sandbox("in-flight-failures");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        r#"{"updatedAt":"2026-09-15T00:00:00.000Z","stages":{"ultragoal":{"status":"active","evidence":[
            {"command":"npm test","exitCode":1,"at":"t"},{"command":"npm test","exitCode":1,"at":"t"}]}}}"#,
    )
    .expect("write state");
    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "2026-09-15T00:10:00Z") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(
        response.contains("$ultragoal: active — 2 failing command(s), last: npm test -> exit 1"),
        "failures not surfaced: {response}"
    );
    assert!(response.contains("Last codex-goat activity: 10 minutes ago"), "no staleness line: {response}");
    assert!(!response.contains("confirm it is still current"), "10 minutes is not stale: {response}");
}

#[test]
fn session_start_flags_state_older_than_a_week() {
    let dir = sandbox("stale-state");
    fs::write(
        dir.join(".goat").join("state").join("state.json"),
        r#"{"updatedAt":"2026-09-01T00:00:00.000Z","objective":"old goal","stages":{}}"#,
    )
    .expect("write state");
    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "2026-09-15T00:00:00Z") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(response.contains("14 days ago"), "{response}");
    assert!(response.contains("confirm it is still current before resuming"), "{response}");
}

/// Session notes are capped under Codex's 2,500-token spill limit and point at the file.
#[test]
fn session_notes_are_capped_with_a_pointer() {
    let dir = sandbox("notes-cap");
    fs::write(dir.join(".goat").join("SESSION.md"), "x".repeat(6_000)).expect("write notes");
    let HookOutcome::Handled(response) = handle(&payload("SessionStart", &dir, ""), "2026-09-15T00:00:00Z") else {
        panic!("SessionStart must be handled natively");
    };
    assert!(response.contains("truncated; read .goat/SESSION.md for the rest"), "{response}");
    assert!(response.len() < 5_000, "notes were not capped: {} bytes", response.len());
}

#[test]
fn iso_timestamps_parse_and_diff() {
    use goat_runtime::state::{describe_age, iso_to_epoch_seconds};
    let a = iso_to_epoch_seconds("2026-09-15T07:22:53.790Z").expect("parse a");
    let b = iso_to_epoch_seconds("2026-09-15T07:32:53Z").expect("parse b");
    assert_eq!(b - a, 600);
    assert_eq!(iso_to_epoch_seconds("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(iso_to_epoch_seconds("garbage"), None);
    assert_eq!(describe_age(30), "moments");
    assert_eq!(describe_age(600), "10 minutes");
    assert_eq!(describe_age(5 * 3_600), "5 hours");
    assert_eq!(describe_age(14 * 86_400), "14 days");
}
