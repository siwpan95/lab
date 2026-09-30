// chess-cordis harness-side driver for RustChess (NOT part of the engine).
// Includes the RustChess core sources via #[path] so the engine stays
// zero-dependency and cordis-unaware. Serves perft / legalMoves / bestMove
// over line-delimited JSON on stdin/stdout (no external crates; minimal JSON
// parsing is hand-rolled to avoid a network dependency).

#[path = "../../../../RustChess/src/chess_core.rs"]
mod chess_core;
#[path = "../../../../RustChess/src/chess_ai.rs"]
mod chess_ai;

use chess_core::{GameState, Move, Rules};
use chess_ai::AIEngine;
use std::collections::HashMap;
use std::io::{self, BufRead, Write, BufWriter};
use std::rc::Rc;

// ---------- minimal JSON field extractor ----------

fn get_field<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{}\"", key);
    let idx = s.find(&pat)?;
    let rest = &s[idx + pat.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    let rest = rest.trim_start();
    if rest.starts_with('"') {
        let q = &rest[1..];
        let end = q.find('"')?;
        Some(&q[..end])
    } else {
        let end = rest.find(|c| c == ',' || c == '}' || c == ' ')?;
        Some(&rest[..end])
    }
}

// Parse the `history` JSON array field (array of strings) into a Vec<String>.
// Returns an empty Vec if the field is absent or malformed.
fn parse_history_array(s: &str) -> Vec<String> {
    let pat = "\"history\"";
    let idx = match s.find(pat) {
        Some(i) => i,
        None => return Vec::new(),
    };
    let rest = &s[idx + pat.len()..];
    let rest = match rest.trim_start().strip_prefix(':') {
        Some(r) => r,
        None => return Vec::new(),
    };
    let rest = rest.trim_start();
    let open = match rest.find('[') {
        Some(i) => i,
        None => return Vec::new(),
    };
    let close = match rest[open..].find(']') {
        Some(i) => open + i,
        None => return Vec::new(),
    };
    let inner = &rest[open + 1..close];
    let mut v = Vec::new();
    for part in inner.split(',') {
        let p = part.trim();
        if p.len() >= 2 && p.starts_with('"') && p.ends_with('"') {
            v.push(p[1..p.len() - 1].to_string());
        }
    }
    v
}

// ---------- FEN parsing (mirrors the engine's own setup) ----------

fn from_fen(fen: &str) -> GameState {
    let mut s = GameState::new();
    for r in 0..8 {
        for c in 0..8 {
            s.board[r][c] = '.';
        }
    }
    let parts: Vec<&str> = fen.split_whitespace().collect();
    let placement = parts.get(0).copied().unwrap_or("");
    let side = parts.get(1).copied().unwrap_or("w");
    let castling = parts.get(2).copied().unwrap_or("-");
    let ep = parts.get(3).copied().unwrap_or("-");
    let halfmove: i32 = parts.get(4).and_then(|x| x.parse().ok()).unwrap_or(0);
    let fullmove: i32 = parts.get(5).and_then(|x| x.parse().ok()).unwrap_or(1);

    let mut r = 0;
    let mut c = 0;
    for ch in placement.chars() {
        if ch == '/' {
            r += 1;
            c = 0;
            continue;
        }
        if ch.is_ascii_digit() {
            c += ch.to_digit(10).unwrap() as usize;
            continue;
        }
        s.board[r][c] = ch;
        c += 1;
    }

    s.white_to_move = side == "w";
    s.can_castle_wk = castling.contains('K');
    s.can_castle_wq = castling.contains('Q');
    s.can_castle_bk = castling.contains('k');
    s.can_castle_bq = castling.contains('q');
    if ep != "-" && ep.len() == 2 {
        let b = ep.as_bytes();
        s.en_passant_col = (b[0] - b'a') as i32;
        s.en_passant_row = 8 - (b[1] - b'0') as i32;
    } else {
        s.en_passant_row = -1;
        s.en_passant_col = -1;
    }
    s.halfmove_clock = halfmove;
    s.fullmove_number = fullmove;
    s.history.clear();
    s.position_keys.clear();
    s.rep_history = None;
    s
}

fn move_to_uci(m: &Move) -> String {
    let files = "abcdefgh";
    let mut uci = String::new();
    uci.push(files.chars().nth(m.from_col as usize).unwrap());
    uci.push_str(&(8 - m.from_row).to_string());
    uci.push(files.chars().nth(m.to_col as usize).unwrap());
    uci.push_str(&(8 - m.to_row).to_string());
    if m.promotion != '.' {
        uci.push(m.promotion.to_ascii_lowercase());
    }
    uci
}

fn perft(state: &GameState, depth: i32) -> i64 {
    if depth == 0 {
        return 1;
    }
    let moves = Rules::generate_all_legal_moves(state);
    if depth == 1 {
        return moves.len() as i64;
    }
    let mut count = 0i64;
    for m in &moves {
        let mut child = state.clone_light();
        Rules::apply_move(&mut child, m, false);
        count += perft(&child, depth - 1);
    }
    count
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    out.write_all(b"{\"ready\":true}\n").unwrap();
    out.flush().unwrap();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let id = get_field(line, "id").unwrap_or("");
        let cmd = get_field(line, "cmd").unwrap_or("");
        let fen = get_field(line, "fen").unwrap_or("");
        let depth: i32 = get_field(line, "depth").and_then(|x| x.parse().ok()).unwrap_or(0);
        // timeMs: Tier 2-B optional per-move budget in milliseconds.
        // Absent/0 ⇒ fixed-depth search (behaviour unchanged from before Tier 2-B).
        let time_ms: i32 = get_field(line, "timeMs")
            .and_then(|x| x.parse::<f64>().ok())
            .unwrap_or(0.0) as i32;
        let mut state = from_fen(fen);
        match cmd {
            "perft" => {
                let n = perft(&state, depth);
                writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"nodes\":{}}}", id, n).unwrap();
            }
            "legalMoves" => {
                let n = Rules::generate_all_legal_moves(&state).len();
                writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"moves\":{}}}", id, n).unwrap();
            }
            "bestMove" => {
                // Build the repetition-penalty lookup from the runner-supplied history
                // (engine.mjs position keys seen so far). Empty/absent ⇒ no penalty.
                let history = parse_history_array(line);
                if !history.is_empty() {
                    let mut rep: HashMap<String, i32> = HashMap::new();
                    for k in &history {
                        *rep.entry(k.clone()).or_insert(0) += 1;
                    }
                    state.rep_history = Some(Rc::new(rep));
                }
                match AIEngine::find_best_move_timed(&state, depth, time_ms) {
                    Some(mv) => {
                        let u = move_to_uci(&mv);
                        writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"move\":\"{}\",\"score\":0}}", id, u).unwrap();
                    }
                    None => {
                        writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"move\":null,\"score\":0}}", id).unwrap();
                    }
                }
            }
            "positionKey" => {
                // Read-only verification aid: returns the engine.mjs-compatible key of
                // the requested FEN. Not used by the tournament runner.
                let key = state.position_key_simple();
                writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"key\":\"{}\"}}", id, key).unwrap();
            }
            "evalProfile" => {
                // Read-only verification aid: returns this engine's Tier 2-C eval
                // profile name and its djb2-32 hash (same algorithm as the harness).
                writeln!(
                    out,
                    "{{\"id\":\"{}\",\"ok\":true,\"profile\":\"{}\",\"hash\":\"{}\"}}",
                    id,
                    chess_ai::EVAL_PROFILE_NAME,
                    chess_ai::profile_hash()
                )
                .unwrap();
            }
            _ => {
                writeln!(out, "{{\"id\":\"{}\",\"ok\":false,\"error\":\"unknown cmd\"}}", id).unwrap();
            }
        }
        out.flush().unwrap();
    }
}
