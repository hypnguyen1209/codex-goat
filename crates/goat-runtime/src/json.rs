//! A minimal JSON reader/writer.
//!
//! `goat-runtime` exists to start in single-digit milliseconds, and pulling in a full
//! serialization stack works against that. Only what the hook contract needs is
//! implemented: parse a document, read fields by path, and emit escaped strings.

use std::collections::BTreeMap;
use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(map) => map.get(key),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }
}

pub fn parse(input: &str) -> Result<Json, String> {
    let bytes: Vec<char> = input.chars().collect();
    let mut parser = Parser { chars: &bytes, pos: 0 };
    parser.skip_whitespace();
    let value = parser.parse_value()?;
    parser.skip_whitespace();
    if parser.pos != parser.chars.len() {
        return Err(format!("trailing input at byte {}", parser.pos));
    }
    Ok(value)
}

struct Parser<'a> {
    chars: &'a [char],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let current = self.peek();
        if current.is_some() {
            self.pos += 1;
        }
        current
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, expected: char) -> Result<(), String> {
        match self.bump() {
            Some(found) if found == expected => Ok(()),
            Some(found) => Err(format!("expected '{expected}', found '{found}'")),
            None => Err(format!("expected '{expected}', found end of input")),
        }
    }

    fn parse_value(&mut self) -> Result<Json, String> {
        self.skip_whitespace();
        match self.peek() {
            Some('{') => self.parse_object(),
            Some('[') => self.parse_array(),
            Some('"') => Ok(Json::String(self.parse_string()?)),
            Some('t') => self.parse_literal("true", Json::Bool(true)),
            Some('f') => self.parse_literal("false", Json::Bool(false)),
            Some('n') => self.parse_literal("null", Json::Null),
            Some(_) => self.parse_number(),
            None => Err("unexpected end of input".to_string()),
        }
    }

    fn parse_literal(&mut self, word: &str, value: Json) -> Result<Json, String> {
        for expected in word.chars() {
            self.expect(expected)?;
        }
        Ok(value)
    }

    fn parse_object(&mut self) -> Result<Json, String> {
        self.expect('{')?;
        let mut map = BTreeMap::new();
        self.skip_whitespace();
        if self.peek() == Some('}') {
            self.pos += 1;
            return Ok(Json::Object(map));
        }
        loop {
            self.skip_whitespace();
            let key = self.parse_string()?;
            self.skip_whitespace();
            self.expect(':')?;
            let value = self.parse_value()?;
            map.insert(key, value);
            self.skip_whitespace();
            match self.bump() {
                Some(',') => continue,
                Some('}') => return Ok(Json::Object(map)),
                other => return Err(format!("expected ',' or '}}', found {other:?}")),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Json, String> {
        self.expect('[')?;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(']') {
            self.pos += 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_whitespace();
            match self.bump() {
                Some(',') => continue,
                Some(']') => return Ok(Json::Array(items)),
                other => return Err(format!("expected ',' or ']', found {other:?}")),
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            match self.bump() {
                None => return Err("unterminated string".to_string()),
                Some('"') => return Ok(out),
                Some('\\') => match self.bump() {
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('/') => out.push('/'),
                    Some('b') => out.push('\u{0008}'),
                    Some('f') => out.push('\u{000C}'),
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('u') => out.push(self.parse_unicode_escape()?),
                    other => return Err(format!("invalid escape {other:?}")),
                },
                Some(ch) => out.push(ch),
            }
        }
    }

    fn parse_unicode_escape(&mut self) -> Result<char, String> {
        let high = self.parse_hex4()?;
        // Surrogate pair: JSON encodes astral characters as \uD8xx\uDCxx.
        if (0xD800..0xDC00).contains(&high) {
            if self.peek() == Some('\\') {
                self.pos += 1;
                self.expect('u')?;
                let low = self.parse_hex4()?;
                let combined = 0x10000 + (((high - 0xD800) as u32) << 10) + (low - 0xDC00) as u32;
                return char::from_u32(combined).ok_or_else(|| "invalid surrogate pair".to_string());
            }
            return Err("lone high surrogate".to_string());
        }
        char::from_u32(high as u32).ok_or_else(|| "invalid code point".to_string())
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        let mut value: u16 = 0;
        for _ in 0..4 {
            let ch = self.bump().ok_or_else(|| "truncated \\u escape".to_string())?;
            let digit = ch.to_digit(16).ok_or_else(|| format!("invalid hex digit '{ch}'"))?;
            value = value * 16 + digit as u16;
        }
        Ok(value)
    }

    fn parse_number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-')
        {
            self.pos += 1;
        }
        let text: String = self.chars[start..self.pos].iter().collect();
        text.parse::<f64>()
            .map(Json::Number)
            .map_err(|_| format!("invalid number '{text}'"))
    }
}

/// Escape a string for embedding in a JSON document.
pub fn escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_objects() {
        let doc = parse(r#"{"a":{"b":["x",1,true,null]}}"#).expect("parse");
        let inner = doc
            .get("a")
            .and_then(|value| value.get("b"))
            .and_then(Json::as_array)
            .expect("array");
        assert_eq!(inner.len(), 4);
        assert_eq!(inner[0].as_str(), Some("x"));
        assert_eq!(inner[3], Json::Null);
    }

    #[test]
    fn handles_escapes_and_surrogate_pairs() {
        let doc = parse(r#"{"k":"line\nbreak A 😀"}"#).expect("parse");
        assert_eq!(doc.get("k").and_then(Json::as_str), Some("line\nbreak A 😀"));
    }

    #[test]
    fn rejects_trailing_input() {
        assert!(parse(r#"{"a":1} {"b":2}"#).is_err());
    }

    #[test]
    fn escape_round_trips_control_characters() {
        let escaped = escape("a\"b\\c\nd\u{1}");
        let doc = parse(&format!("{{\"v\":{escaped}}}")).expect("parse");
        assert_eq!(doc.get("v").and_then(Json::as_str), Some("a\"b\\c\nd\u{1}"));
    }
}
