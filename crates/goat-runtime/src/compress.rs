//! Deterministic prose compression for session memory.
//!
//! The guarantee that matters: code spans, URLs, file paths, filenames, and version
//! numbers are preserved byte-for-byte. Only the prose between them is shortened.
//!
//! This is implemented twice — here and in `src/state/memory.ts` — because both the
//! native and the Node hook path must produce identical output. `tests/compress.rs` and
//! `src/__tests__/compress-parity.test.ts` both read `tests/fixtures/compress.json`, so
//! the two implementations cannot silently drift.

/// Filler phrases removed from unprotected prose, matched case-insensitively.
///
/// Every entry is an adverbial deletable in ANY position without changing what the
/// sentence asserts. v0.1.2 also carried subject-verb openers and hedges, which damaged
/// meaning: "let me know ..." lost its verb, and "I think X" became a bare assertion of X.
/// Hedges carry epistemic status; openers carry agency. Neither is filler.
const FILLER: &[&str] = &[
    "basically ",
    "essentially ",
    "actually ",
    "obviously ",
    "of course ",
    "please note that ",
    "it is worth noting that ",
    "as you can see ",
    "in order to ",
];

/// True when the character can appear inside a protected span (path, filename, version).
fn is_token_char(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | '\\' | ':')
}

/// Split the input into `(protected, text)` segments in source order.
///
/// Protected segments are backtick spans, URLs, and any token containing `/`, `\`, or a
/// `.` between word characters — which covers paths, filenames, and version numbers.
fn segment(input: &str) -> Vec<(bool, String)> {
    let chars: Vec<char> = input.chars().collect();
    let mut segments: Vec<(bool, String)> = Vec::new();
    let mut plain = String::new();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];

        if ch == '`' {
            // A ``` fence must be matched before a single backtick, or the opener reads as
            // an empty inline span and the block's newlines fall through to the whitespace
            // collapse — which flattened recorded test output onto one line.
            let is_fence = chars.get(index + 1) == Some(&'`') && chars.get(index + 2) == Some(&'`');
            if is_fence {
                let rest: String = chars[index + 3..].iter().collect();
                if let Some(close_at) = rest.find("```") {
                    if !plain.is_empty() {
                        segments.push((false, std::mem::take(&mut plain)));
                    }
                    segments.push((true, format!("```{}```", &rest[..close_at])));
                    index += 3 + rest[..close_at].chars().count() + 3;
                    continue;
                }
            }
            if !is_fence {
                if let Some(end) = chars[index + 1..].iter().position(|&c| c == '`') {
                    let close = index + 1 + end;
                    if !plain.is_empty() {
                        segments.push((false, std::mem::take(&mut plain)));
                    }
                    segments.push((true, chars[index..=close].iter().collect()));
                    index = close + 1;
                    continue;
                }
            }
        }

        if is_token_char(ch) {
            let start = index;
            while index < chars.len() && is_token_char(chars[index]) {
                index += 1;
            }
            let token: String = chars[start..index].iter().collect();
            if is_protected_token(&token) {
                if !plain.is_empty() {
                    segments.push((false, std::mem::take(&mut plain)));
                }
                segments.push((true, token));
            } else {
                plain.push_str(&token);
            }
            continue;
        }

        plain.push(ch);
        index += 1;
    }

    if !plain.is_empty() {
        segments.push((false, plain));
    }
    segments
}

fn is_protected_token(token: &str) -> bool {
    if token.starts_with("http://") || token.starts_with("https://") {
        return true;
    }
    if token.contains('/') || token.contains('\\') {
        return true;
    }
    // `file.ts`, `1.2.3`, `pkg.json` — a dot with content on both sides.
    if let Some(dot) = token.find('.') {
        let before = &token[..dot];
        let after = &token[dot + 1..];
        if !before.is_empty() && !after.is_empty() && !after.starts_with('.') {
            return true;
        }
    }
    false
}

/// Remove every filler occurrence, not just the first few.
///
/// Each pass deletes at most one occurrence and then restarts, because removing a phrase
/// shifts every later index and can expose a new match ("let me actually ..."). v0.1.0
/// broke out of the phrase loop and capped at three passes, so a sentence with ten filler
/// phrases kept seven. The bound is proportional to the work available: every pass that
/// changes anything strictly shortens the string, so this terminates.
///
/// Kept behaviourally identical to `stripFiller` in `src/state/memory.ts`; the shared
/// fixture in `tests/fixtures/compress.json` is what proves it.
fn strip_filler(text: &str) -> String {
    let mut out = text.to_string();
    let max_passes = text.len() + 1;

    for _ in 0..max_passes {
        let lower = out.to_lowercase();
        let mut removal: Option<(usize, usize)> = None;

        // Prefer the earliest match in the string so removal order is position-driven and
        // therefore independent of the order phrases happen to appear in FILLER.
        for phrase in FILLER {
            let mut search_from = 0;
            while let Some(found) = lower[search_from..].find(phrase) {
                let start = search_from + found;
                // Only strip at a word boundary.
                let boundary = start == 0 || !lower.as_bytes()[start - 1].is_ascii_alphanumeric();
                if boundary {
                    if removal.is_none_or(|(at, _)| start < at) {
                        removal = Some((start, phrase.len()));
                    }
                    break;
                }
                search_from = start + phrase.len();
                if search_from >= lower.len() {
                    break;
                }
            }
        }

        match removal {
            Some((start, len)) => out.replace_range(start..start + len, ""),
            None => break,
        }
    }

    out
}

fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !previous_space {
                out.push(' ');
            }
            previous_space = true;
        } else {
            out.push(ch);
            previous_space = false;
        }
    }
    out
}

/// Compress prose while leaving code, paths, URLs, filenames, and versions untouched.
///
/// Every transformation happens INSIDE an unprotected segment. v0.1.2 collapsed whitespace
/// over the joined string as a final pass, which reached into protected spans and flattened
/// a recorded ``` block onto one line.
pub fn compress(input: &str) -> String {
    let out: String = segment(input)
        .into_iter()
        .map(|(protected, text)| {
            if protected {
                text
            } else {
                repair_punctuation(&collapse_whitespace(&strip_filler(&text)))
            }
        })
        .collect();
    out.trim().to_string()
}

/// Close the gap before punctuation only where it ends a clause — followed by whitespace
/// or the end of the segment. The unconditional form deleted the space in front of any
/// leading dot, so "run ./scripts/ci.sh" came back as "run./scripts/ci.sh".
fn repair_punctuation(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (index, &ch) in chars.iter().enumerate() {
        if ch == ' ' {
            if let Some(&next) = chars.get(index + 1) {
                let ends_clause = match chars.get(index + 2) {
                    None => true,
                    Some(after) => after.is_whitespace(),
                };
                if matches!(next, '.' | ',' | ';' | ':' | '!' | '?') && ends_clause {
                    continue;
                }
            }
        }
        out.push(ch);
    }
    out
}

/// Remove `<private>...</private>` spans before anything is written to disk.
pub fn redact(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_lowercase();
    let mut cursor = 0;
    while let Some(open) = lower[cursor..].find("<private>") {
        let start = cursor + open;
        out.push_str(&input[cursor..start]);
        out.push_str("[redacted]");
        match lower[start..].find("</private>") {
            Some(close) => cursor = start + close + "</private>".len(),
            None => return out,
        }
    }
    out.push_str(&input[cursor..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_code_spans_and_paths() {
        let input = "I will basically update `useMemo` in src/app/page.tsx to fix v1.2.3";
        let output = compress(input);
        assert!(output.contains("`useMemo`"), "code span lost: {output}");
        assert!(output.contains("src/app/page.tsx"), "path lost: {output}");
        assert!(output.contains("v1.2.3"), "version lost: {output}");
        assert!(
            !output.to_lowercase().contains("basically"),
            "adverbial filler kept: {output}"
        );
        // "I will" is deliberately NOT stripped any more: subject-verb openers carry
        // agency and tense, and removing them damaged meaning ("I will let me down" once
        // compressed to "down").
        assert!(output.contains("I will"), "subject-verb opener was stripped: {output}");
    }

    #[test]
    fn does_not_damage_meaning() {
        // Each of these was corrupted by the v0.1.2 filler list or its punctuation repair.
        assert_eq!(compress("let me know if you want X"), "let me know if you want X");
        assert_eq!(compress("I think the fix works"), "I think the fix works");
        assert_eq!(compress("run ./scripts/ci.sh now"), "run ./scripts/ci.sh now");
        assert_eq!(compress("cd .. then build"), "cd .. then build");
    }

    #[test]
    fn preserves_layout_inside_a_fenced_block() {
        let output = compress("output:\n```\nnpm test\nFAIL a.ts:12\n```\ndone");
        assert!(
            output.contains("```\nnpm test\nFAIL a.ts:12\n```"),
            "fence flattened: {output}"
        );
    }

    #[test]
    fn preserves_urls() {
        let output = compress("Let me check https://example.com/a/b for details");
        assert!(output.contains("https://example.com/a/b"));
    }

    #[test]
    fn does_not_strip_filler_inside_words() {
        // "actually" appears inside "factually", which must survive.
        let output = compress("The claim is factually correct");
        assert!(output.contains("factually"), "word damaged: {output}");
    }

    #[test]
    fn redacts_private_spans() {
        assert_eq!(redact("a <private>secret</private> b"), "a [redacted] b");
        assert_eq!(redact("a <private>unterminated"), "a [redacted]");
    }
}
