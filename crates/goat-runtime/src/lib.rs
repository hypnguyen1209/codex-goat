//! Optional native helper for codex-goat.
//!
//! Nothing here is required: `hooks/goat-hook.mjs` falls back to the TypeScript handler
//! whenever this binary is absent or declines an event. Building it only makes the
//! session-lifecycle hooks faster.

pub mod compress;
pub mod hook;
pub mod json;
pub mod state;

/// Exit code meaning "this event belongs to the Node handler".
pub const EXIT_DELEGATE: i32 = 3;
