//! Durable `.goat/` access: project-root discovery, atomic state writes, and the
//! append-only memory log.
//!
//! `PROJECT_ROOT_MARKERS` and the `.goat/` layout mirror `src/core/paths.ts`. Keep the
//! two lists in the same order; a divergence makes the native and Node hook paths resolve
//! different roots for the same directory.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::compress::{compress, redact};
use crate::json::{self, Json};

/// Markers that identify a project root, highest precedence first.
pub const PROJECT_ROOT_MARKERS: &[&str] = &[
    ".git",
    ".goat",
    ".codex",
    ".agents",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
];

pub fn find_project_root(start: &Path) -> PathBuf {
    let mut dir = start.to_path_buf();
    loop {
        for marker in PROJECT_ROOT_MARKERS {
            if dir.join(marker).exists() {
                return dir;
            }
        }
        match dir.parent() {
            Some(parent) if parent != dir => dir = parent.to_path_buf(),
            _ => return start.to_path_buf(),
        }
    }
}

pub fn goat_root(start: &Path) -> PathBuf {
    match std::env::var("GOAT_ROOT") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => find_project_root(start).join(".goat"),
    }
}

pub fn state_file(start: &Path) -> PathBuf {
    goat_root(start).join("state").join("state.json")
}

pub fn memory_file(start: &Path) -> PathBuf {
    goat_root(start).join("memory").join("observations.jsonl")
}

pub fn read_state(start: &Path) -> Option<Json> {
    let contents = fs::read_to_string(state_file(start)).ok()?;
    json::parse(&contents).ok()
}

pub fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub ts: String,
    pub session_id: String,
    pub kind: String,
    pub text: String,
}

/// Compress and redact, then append. Returns `None` when nothing survived compression.
pub fn record_observation(start: &Path, session_id: &str, kind: &str, text: &str, now: &str) -> Option<Observation> {
    let cleaned: String = compress(&redact(text)).chars().take(600).collect();
    if cleaned.is_empty() {
        return None;
    }
    let observation = Observation {
        ts: now.to_string(),
        session_id: session_id.to_string(),
        kind: kind.to_string(),
        text: cleaned,
    };
    let line = format!(
        "{{\"ts\":{},\"sessionId\":{},\"kind\":{},\"text\":{}}}",
        json::escape(&observation.ts),
        json::escape(&observation.session_id),
        json::escape(&observation.kind),
        json::escape(&observation.text)
    );
    append_line(&memory_file(start), &line).ok()?;
    Some(observation)
}

pub fn recent_observations(start: &Path, limit: usize) -> Vec<Observation> {
    let Ok(contents) = fs::read_to_string(memory_file(start)) else {
        return Vec::new();
    };
    let lines: Vec<&str> = contents.lines().filter(|line| !line.trim().is_empty()).collect();
    let tail = lines.len().saturating_sub(limit);
    lines[tail..]
        .iter()
        .filter_map(|line| {
            let doc = json::parse(line).ok()?;
            Some(Observation {
                ts: doc.get("ts").and_then(Json::as_str).unwrap_or_default().to_string(),
                session_id: doc
                    .get("sessionId")
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .to_string(),
                kind: doc.get("kind").and_then(Json::as_str).unwrap_or("note").to_string(),
                text: doc.get("text").and_then(Json::as_str)?.to_string(),
            })
        })
        .collect()
}

/// The most recent DISTINCT observations, oldest first.
///
/// Mirrors `memoryDigest` in `src/state/memory.ts`. Agents repeat themselves: a measured
/// mid-project session emitted eight byte-identical lines, 76% of the whole SessionStart
/// injection saying one thing eight times. Duplicates are dropped oldest-first so the
/// surviving copy keeps its most recent position, and `limit` counts distinct entries.
pub fn memory_digest(start: &Path, limit: usize) -> Option<String> {
    // Over-read: duplicates collapse and would otherwise shrink the digest below `limit`.
    let recent = recent_observations(start, limit.saturating_mul(4));
    if recent.is_empty() {
        return None;
    }

    let mut seen = std::collections::HashSet::new();
    let mut distinct: Vec<&Observation> = Vec::new();
    for entry in recent.iter().rev() {
        if !seen.insert(format!("{} {}", entry.kind, entry.text)) {
            continue;
        }
        distinct.push(entry);
        if distinct.len() == limit {
            break;
        }
    }
    if distinct.is_empty() {
        return None;
    }
    distinct.reverse();

    let lines: Vec<String> = distinct.iter().map(|o| format!("- [{}] {}", o.kind, o.text)).collect();
    Some(format!(
        "Recent session memory (most recent last):\n{}",
        lines.join("\n")
    ))
}
