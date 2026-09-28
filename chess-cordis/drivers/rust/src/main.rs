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
use std::io::{self, BufRead, Write, BufWriter};

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
        let state = from_fen(fen);
        match cmd {
            "perft" => {
                let n = perft(&state, depth);
                writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"nodes\":{}}}", id, n).unwrap();
            }
            "legalMoves" => {
                let n = Rules::generate_all_legal_moves(&state).len();
                writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"moves\":{}}}", id, n).unwrap();
            }
            "bestMove" => match AIEngine::find_best_move(&state, depth) {
                Some(mv) => {
                    let u = move_to_uci(&mv);
                    writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"move\":\"{}\",\"score\":0}}", id, u).unwrap();
                }
                None => {
                    writeln!(out, "{{\"id\":\"{}\",\"ok\":true,\"move\":null,\"score\":0}}", id).unwrap();
                }
            },
            _ => {
                writeln!(out, "{{\"id\":\"{}\",\"ok\":false,\"error\":\"unknown cmd\"}}", id).unwrap();
            }
        }
        out.flush().unwrap();
    }
}
