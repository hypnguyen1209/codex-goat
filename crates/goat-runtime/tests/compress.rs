//! Parity fixture shared with the TypeScript implementation.
//!
//! `src/__tests__/memory.test.ts` reads the same file. If the two compressors ever
//! diverge, one of the two suites fails — session memory must not depend on whether the
//! native binary happened to be built.

use std::fs;
use std::path::PathBuf;

use goat_runtime::compress::compress;
use goat_runtime::json::{self, Json};

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("compress.json")
}

#[test]
fn matches_shared_fixture() {
    let raw = fs::read_to_string(fixture_path()).expect("read compress fixture");
    let cases = json::parse(&raw).expect("parse compress fixture");
    let cases = cases.as_array().expect("fixture must be an array");
    assert!(!cases.is_empty(), "fixture is empty");

    for case in cases {
        let input = case.get("input").and_then(Json::as_str).expect("case.input");
        let expected = case.get("expected").and_then(Json::as_str).expect("case.expected");
        assert_eq!(compress(input), expected, "diverged on: {input}");
    }
}
