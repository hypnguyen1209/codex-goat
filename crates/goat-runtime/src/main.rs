//! `goat-runtime` — the optional native helper.
//!
//! Commands:
//!   goat-runtime hook        read one hook payload on stdin, write the response to stdout
//!   goat-runtime compress    compress stdin as session memory would (used by parity tests)
//!   goat-runtime digest      print the current memory digest
//!   goat-runtime root        print the resolved .goat root
//!
//! Failure policy for `hook`: never panic, never block. Exit 0 with a response, or exit
//! `EXIT_DELEGATE` (3) to hand the event back to the Node handler.

use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use goat_runtime::hook::{self, HookOutcome};
use goat_runtime::{compress, state, EXIT_DELEGATE};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("help");

    match command {
        "hook" => run_hook(),
        "compress" => {
            let input = read_stdin();
            println!("{}", compress::compress(&compress::redact(&input)));
            ExitCode::SUCCESS
        }
        "digest" => {
            let cwd = current_dir();
            match state::memory_digest(&cwd, 8) {
                Some(digest) => println!("{digest}"),
                None => println!(),
            }
            ExitCode::SUCCESS
        }
        "root" => {
            println!("{}", state::goat_root(&current_dir()).display());
            ExitCode::SUCCESS
        }
        "--version" | "-V" | "version" => {
            println!("goat-runtime {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: goat-runtime <hook|compress|digest|root|version>");
            ExitCode::from(2)
        }
    }
}

fn run_hook() -> ExitCode {
    let raw = read_stdin();
    if raw.trim().is_empty() {
        print!("{{}}");
        let _ = io::stdout().flush();
        return ExitCode::SUCCESS;
    }

    match hook::handle(&raw, &now_iso8601()) {
        HookOutcome::Handled(response) => {
            print!("{response}");
            let _ = io::stdout().flush();
            ExitCode::SUCCESS
        }
        HookOutcome::Delegate => ExitCode::from(EXIT_DELEGATE as u8),
    }
}

fn read_stdin() -> String {
    let mut buffer = String::new();
    let _ = io::stdin().read_to_string(&mut buffer);
    buffer
}

fn current_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Format the current time as UTC ISO-8601, matching JavaScript's `toISOString()`.
///
/// Written by hand rather than pulling in a date crate: this binary's whole purpose is a
/// fast, dependency-free start.
fn now_iso8601() -> String {
    let seconds_total = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_millis())
        .unwrap_or(0);

    let days_total = (seconds_total / 86_400) as i64;
    let seconds_of_day = seconds_total % 86_400;
    let (hour, minute, second) = (seconds_of_day / 3600, (seconds_of_day % 3600) / 60, seconds_of_day % 60);
    let (year, month, day) = civil_from_days(days_total);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Howard Hinnant's `civil_from_days`: days since the Unix epoch -> (year, month, day).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn converts_known_epoch_days() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        // 2024 is a leap year: day 59 of the year is Feb 29.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }
}
