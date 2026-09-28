// =============================================================================
// main.rs — Rust 国际象棋入口（CLI, 对齐 C++ main.cpp）
// 子命令：
//   rustchess                运行 97 项自测（默认）
//   rustchess test           运行 97 项自测
//   rustchess selfplay N D  AI(白) vs AI(黑) 各走 N 步，深度 D
//   rustchess bench D       从初始局面做 FindBestMove 计时（深度 D）
//   rustchess play [ai]     文本交互对弈；加 ai 则人类执白、AI(黑) 接手
// =============================================================================

#![allow(dead_code)]

mod chess_ai;
mod chess_core;
mod tests;

use chess_core::{GameState, Move, Rules, SpecialMove};
use chess_ai::AIEngine;

// 渲染棋盘（字母简记 + 坐标）
fn print_board(s: &GameState) {
    println!("  +------------------------+");
    for r in 0..8 {
        let mut line = format!("{} | ", 8 - r);
        for c in 0..8 {
            line.push(s.board[r][c]);
            line.push(' ');
        }
        line.push('|');
        println!("{}", line);
    }
    println!("  +------------------------+");
    println!("    a b c d e f g h");
}

// 解析 "e2e4" 形式坐标串
fn parse_square(sq: &str) -> Option<(i32, i32)> {
    let chars: Vec<char> = sq.chars().collect();
    if chars.len() != 2 {
        return None;
    }
    let col = chars[0] as i32 - 'a' as i32;
    let row = 8 - (chars[1] as i32 - '0' as i32);
    if col < 0 || col > 7 || row < 0 || row > 7 {
        return None;
    }
    Some((row, col))
}

fn cmd_tests() -> i32 {
    let fails = tests::run_tests();
    if fails == 0 {
        0
    } else {
        1
    }
}

fn cmd_selfplay(nmoves: i32, depth: i32) -> i32 {
    let mut s = GameState::new();
    println!("=== AI vs AI 自对弈（深度 {}，各 {} 步） ===", depth, nmoves);
    for _ in 0..nmoves {
        let all = Rules::generate_all_legal_moves(&s);
        if all.is_empty() {
            println!("对局结束：");
            if Rules::is_in_check(&s, s.white_to_move) {
                println!("{}", if s.white_to_move { "黑方将死白方" } else { "白方将死黑方" });
            } else {
                println!("逼和/和棋");
            }
            print_board(&s);
            return 0;
        }
        let best = AIEngine::find_best_move(&s, depth);
        if best.is_none() {
            println!("无最佳走法（异常）");
            return 1;
        }
        let best = best.unwrap();
        Rules::apply_move(&mut s, &best, true);
        println!("{}: {}", if s.white_to_move { "黑" } else { "白" }, best.to_string());
    }
    print_board(&s);
    println!("半步计数: {}  走子历史条数: {}", s.halfmove_clock, s.history.len());
    0
}

fn cmd_bench(depth: i32) -> i32 {
    let s = GameState::new();
    let t0 = std::time::Instant::now();
    let best = AIEngine::find_best_move(&s, depth);
    let t1 = std::time::Instant::now();
    let ms = (t1 - t0).as_millis();
    match best {
        Some(b) => println!("深度 {} 建议走法: {}  ({} ms)", depth, b.to_string(), ms),
        None => println!("无走法"),
    }
    0
}

fn cmd_play(vs_ai: bool) -> i32 {
    let mut s = GameState::new();
    let depth = 2;
    println!("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。");
    print_board(&s);
    let mut line = String::new();
    loop {
        if Rules::generate_all_legal_moves(&s).is_empty() {
            println!("对局结束：");
            if Rules::is_in_check(&s, s.white_to_move) {
                println!("{}", if s.white_to_move { "黑方将死白方" } else { "白方将死黑方" });
            } else {
                println!("逼和/和棋");
            }
            break;
        }
        let ai_turn = vs_ai && !s.white_to_move; // 人类执白，AI 执黑
        if ai_turn {
            let best = AIEngine::find_best_move(&s, depth);
            match best {
                Some(b) => {
                    Rules::apply_move(&mut s, &b, true);
                    println!("AI(黑): {}", b.to_string());
                    print_board(&s);
                }
                None => {
                    println!("AI 无走法");
                    break;
                }
            }
            continue;
        }

        print!("{}走子> ", if s.white_to_move { "白方" } else { "黑方" });
        // 简单读取一行（交互模式）
        line.clear();
        if std::io::stdin().read_line(&mut line).is_err() {
            break;
        }
        let input = line.trim().to_string();
        if input == "quit" || input == "exit" {
            break;
        }
        if input == "new" {
            s.reset_to_start_position();
            print_board(&s);
            continue;
        }

        if input.len() < 4 {
            println!("格式错误（示例 e2e4）");
            continue;
        }
        let from = &input[0..2];
        let to = &input[2..4];
        let (fr, fc) = match parse_square(from) {
            Some(v) => v,
            None => {
                println!("坐标非法");
                continue;
            }
        };
        let (tr, tc) = match parse_square(to) {
            Some(v) => v,
            None => {
                println!("坐标非法");
                continue;
            }
        };
        let mut chosen: Option<Move> = None;
        for m in Rules::generate_legal_moves(&s, fr, fc) {
            if m.to_row == tr && m.to_col == tc {
                if m.special == SpecialMove::Promotion && m.promotion != 'Q' {
                    continue;
                }
                chosen = Some(m);
            }
        }
        match chosen {
            Some(ch) => {
                Rules::apply_move(&mut s, &ch, true);
                print_board(&s);
                if Rules::is_in_check(&s, s.white_to_move) {
                    println!("将军！");
                }
            }
            None => println!("非法走法"),
        }
    }
    0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = if args.len() >= 2 {
        let cmd = args[1].as_str();
        match cmd {
            "test" => cmd_tests(),
            "selfplay" => {
                let n = if args.len() >= 3 { args[2].parse().unwrap_or(8) } else { 8 };
                let d = if args.len() >= 4 { args[3].parse().unwrap_or(2) } else { 2 };
                cmd_selfplay(n, d)
            }
            "bench" => {
                let d = if args.len() >= 3 { args[2].parse().unwrap_or(3) } else { 3 };
                cmd_bench(d)
            }
            "play" => {
                let ai = args.len() >= 3 && args[2] == "ai";
                cmd_play(ai)
            }
            _ => {
                println!("未知子命令: {}", cmd);
                println!("可用: test | selfplay [N] [D] | bench [D] | play [ai]");
                1
            }
        }
    } else {
        cmd_tests()
    };
    std::process::exit(code);
}
