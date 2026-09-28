// =============================================================================
// tests.rs — 核心规则自测（Rust, 移植 C++ tests.cpp 的 24 组 / 97 项断言）
// 覆盖：初始走法数 / 过路兵 / 易位 / 升变 / 将死 / 逼和 / 子力不足 / 50 步 /
//       三次重复 / 评估 / negamax 终局 / AI / 钉死 / 逃将 / EP 揭开将军 /
//       子力不足扩展 / 深度计时 / 角格易位权 / 退化局面 / 升变 SAN
// =============================================================================

use std::sync::Mutex;

use crate::chess_core::{GameState, Move, Rules, SpecialMove};
use crate::chess_ai::AIEngine;

// 通过 Mutex 计数器累计 PASS/FAIL（单线程运行；Mutex 满足 static 的 Sync 约束）
static COUNTERS: Mutex<(i32, i32)> = Mutex::new((0, 0));

fn check(name: &str, cond: bool) {
    let mut c = COUNTERS.lock().unwrap();
    if cond {
        c.0 += 1;
        println!("[PASS] {}", name);
    } else {
        c.1 += 1;
        println!("[FAIL] {}", name);
    }
}

// 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
fn find_move(state: &GameState, r: i32, c: i32, tr: i32, tc: i32) -> Move {
    for m in Rules::generate_legal_moves(state, r, c) {
        if m.to_row == tr && m.to_col == tc {
            return m;
        }
    }
    panic!("move not found");
}

// 走一步并返回新状态（深拷贝 + 应用）
fn play(state: &GameState, r: i32, c: i32, tr: i32, tc: i32) -> GameState {
    let m = find_move(state, r, c, tr, tc);
    let mut s = state.clone();
    Rules::apply_move(&mut s, &m, true);
    s
}

// 清空棋盘上所有棋子（测试用）
fn empty_board(s: &mut GameState) {
    for r in 0..8 {
        for c in 0..8 {
            s.board[r][c] = '.';
        }
    }
    s.can_castle_wk = false;
    s.can_castle_wq = false;
    s.can_castle_bk = false;
    s.can_castle_bq = false;
    s.en_passant_row = -1;
    s.en_passant_col = -1;
    s.halfmove_clock = 0;
    s.fullmove_number = 1;
    s.history.clear();
    s.position_keys.clear();
    s.position_keys.push(s.get_position_key());
}

// ---------- 0b. perft 辅助：由 8 条 rank 串构建局面 ----------
// ranks[0] 为第 8 行（顶层 row0），ranks[7] 为第 1 行（row7）。
// 字母 => 对应棋子；数字 N => N 个空格；side-to-move 默认白方。
fn setup_position(ranks: [&str; 8], castling: &str) -> GameState {
    let mut s = GameState::new();
    for r in 0..8 {
        for c in 0..8 {
            s.board[r][c] = '.';
        }
    }
    for (ri, rank) in ranks.iter().enumerate() {
        let row = ri; // rank 8 在前 => row 0
        let mut col: usize = 0;
        for ch in rank.chars() {
            if ch.is_ascii_digit() {
                let n = ch.to_digit(10).unwrap() as usize;
                for _ in 0..n {
                    s.board[row][col] = '.';
                    col += 1;
                }
            } else {
                s.board[row][col] = ch;
                col += 1;
            }
        }
    }
    s.white_to_move = true;
    s.can_castle_wk = castling.contains('K');
    s.can_castle_wq = castling.contains('Q');
    s.can_castle_bk = castling.contains('k');
    s.can_castle_bq = castling.contains('q');
    s.en_passant_row = -1;
    s.en_passant_col = -1;
    s.halfmove_clock = 0;
    s.fullmove_number = 1;
    s.history.clear();
    s.position_keys.clear();
    s.position_keys.push(s.get_position_key());
    s
}

// ---------- 0c. perft（节点计数）黄金值测试 ----------
fn perft(state: &GameState, depth: i32) -> i64 {
    if depth == 0 {
        return 1;
    }
    let moves = Rules::generate_all_legal_moves(state);
    if depth == 1 {
        return moves.len() as i64;
    }
    let mut count: i64 = 0;
    for m in &moves {
        let mut child = state.clone(); // 全量克隆，同现有测试 play()
        Rules::apply_move(&mut child, m, true); // 同现有 3 参数形式
        count += perft(&child, depth - 1);
    }
    count
}

fn test_perft() {
    // Pos1 "Start"
    let start = setup_position(
        [
            "rnbqkbnr", "pppppppp", "........", "........", "........", "........",
            "PPPPPPPP", "RNBQKBNR",
        ],
        "KQkq",
    );
    check("Perft Start d1 = 20", perft(&start, 1) == 20);
    check("Perft Start d2 = 400", perft(&start, 2) == 400);
    check("Perft Start d3 = 8902", perft(&start, 3) == 8902);
    check("Perft Start d4 = 197281", perft(&start, 4) == 197281);

    // Pos2 "Kiwipete"
    let kiwipete = setup_position(
        [
            "r3k2r", "p1ppqpb1", "bn2pnp1", "3PN3", "1p2P3", "2N2Q1p", "PPPBBPPP", "R3K2R",
        ],
        "KQkq",
    );
    check("Perft Kiwipete d1 = 48", perft(&kiwipete, 1) == 48);
    check("Perft Kiwipete d2 = 2039", perft(&kiwipete, 2) == 2039);
    check("Perft Kiwipete d3 = 97862", perft(&kiwipete, 3) == 97862);
    // check("Perft Kiwipete d4 = 4085603", perft(&kiwipete, 4) == 4085603); // 参考，>2M 节点，慢

    // Pos3 "Wiki3"  (canonical perft position 3: 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1)
    let wiki3 = setup_position(
        ["8", "2p5", "3p4", "KP5r", "1R3p1k", "8", "4P1P1", "8"],
        "",
    );
    check("Perft Pos3 d1 = 14", perft(&wiki3, 1) == 14);
    check("Perft Pos3 d2 = 191", perft(&wiki3, 2) == 191);
    check("Perft Pos3 d3 = 2812", perft(&wiki3, 3) == 2812);
    check("Perft Pos3 d4 = 43238", perft(&wiki3, 4) == 43238);

    // Pos4 "Wiki5"
    let wiki5 = setup_position(
        [
            "rnbq1k1r", "pp1Pbppp", "2p5", "8", "2B5", "8", "PPP1NnPP", "RNBQK2R",
        ],
        "KQ",
    );
    check("Perft Pos5 d1 = 44", perft(&wiki5, 1) == 44);
    check("Perft Pos5 d2 = 1486", perft(&wiki5, 2) == 1486);
    check("Perft Pos5 d3 = 62379", perft(&wiki5, 3) == 62379);
    // check("Perft Pos5 d4 = 2103487", perft(&wiki5, 4) == 2103487); // 参考，>2M 节点，慢
}

// ---------- 1. 初始局面 ----------
fn test_initial_position() {
    let s = GameState::new();
    check("初始局面白方合法走法数 = 20", Rules::generate_all_legal_moves(&s).len() == 20);
    check("初始局面 b1 马走法数 = 2", Rules::generate_legal_moves(&s, 7, 1).len() == 2);
    check("初始局面 g1 马走法数 = 2", Rules::generate_legal_moves(&s, 7, 6).len() == 2);
    check("初始局面 e2 兵走法数 = 2", Rules::generate_legal_moves(&s, 6, 4).len() == 2);
    check("初始局面 d1 后走法数 = 0", Rules::generate_legal_moves(&s, 7, 3).len() == 0);
    check("初始局面白王不被将军", !Rules::is_in_check(&s, true));
    check("初始局面黑王不被将军", !Rules::is_in_check(&s, false));
    check("初始局面非将死", !Rules::is_checkmate(&s));

    let mut b = GameState::new();
    b.white_to_move = false;
    check("初始局面黑方合法走法数 = 20", Rules::generate_all_legal_moves(&b).len() == 20);
}

// ---------- 2. IsAttacked 基础语义 ----------
fn test_is_attacked_basics() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[4][4] = 'P'; // 白兵 e4
    s.board[3][4] = 'p'; // 黑兵 e5
    s.board[7][4] = 'K'; // 白王 e1
    s.board[0][4] = 'k'; // 黑王 e8

    check("白兵 e4 攻击 d5", Rules::is_attacked(&s.board, 3, 3, true));
    check("白兵 e4 攻击 f5", Rules::is_attacked(&s.board, 3, 5, true));
    check("白兵 e4 不攻击 e5（兵不直吃）", !Rules::is_attacked(&s.board, 3, 4, true));
    check("黑兵 e5 攻击 d4", Rules::is_attacked(&s.board, 4, 3, false));
    check("黑兵 e5 攻击 f4", Rules::is_attacked(&s.board, 4, 5, false));
    check(
        "a1 格不被任何方攻击",
        !Rules::is_attacked(&s.board, 7, 0, true) && !Rules::is_attacked(&s.board, 7, 0, false),
    );
    check("白王 e1 攻击 e2", Rules::is_attacked(&s.board, 6, 4, true));
}

// ---------- 3. 双进兵与吃过路兵 ----------
fn test_pawn_double_and_en_passant() {
    let s = GameState::new();
    let s = play(&s, 6, 4, 4, 4); // 1. e2-e4
    check("e4 双进兵设置过路兵格 (5,4)", s.en_passant_row == 5 && s.en_passant_col == 4);
    check("双进兵后半步计数 = 0", s.halfmove_clock == 0);
    check("e4 后轮黑方", !s.white_to_move);

    let mut t = GameState::new();
    empty_board(&mut t);
    t.board[3][4] = 'P'; // 白兵 e5
    t.board[1][3] = 'p'; // 黑兵 d7
    t.white_to_move = false;
    let t = play(&t, 1, 3, 3, 3); // 黑 d7-d5
    check("黑 d5 双进后轮白方", t.white_to_move);

    let pawn_moves = Rules::generate_legal_moves(&t, 3, 4);
    let mut has_ep = false;
    for m in &pawn_moves {
        if m.special == SpecialMove::EnPassant {
            has_ep = true;
        }
    }
    check("白 e5 兵存在吃过路兵走法", has_ep);

    let mut ep_move = None;
    for m in &pawn_moves {
        if m.special == SpecialMove::EnPassant {
            ep_move = Some(m.clone());
            break;
        }
    }
    let mut after = t.clone();
    Rules::apply_move(&mut after, ep_move.as_ref().unwrap(), true);
    check("过路兵吃后白兵位于 d6", after.board[2][3] == 'P');
    check("过路兵吃后黑 d5 兵被移除", after.board[3][3] == '.');
    check("过路兵吃后过路兵格已清空", after.en_passant_row == -1);
}

// ---------- 4. 王车易位 ----------
fn test_castling() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][4] = 'K';
    s.board[7][7] = 'R';
    s.board[7][0] = 'R';
    s.board[0][4] = 'k';
    s.can_castle_wk = true;
    s.can_castle_wq = true;
    s.can_castle_bk = true;
    s.can_castle_bq = true;

    let king_moves = Rules::generate_legal_moves(&s, 7, 4);
    let mut castle_k = false;
    let mut castle_q = false;
    for m in &king_moves {
        if m.special == SpecialMove::CastleKingside {
            castle_k = true;
        }
        if m.special == SpecialMove::CastleQueenside {
            castle_q = true;
        }
    }
    check("白王可短易位", castle_k);
    check("白王可长易位", castle_q);

    let mut mv = None;
    for m in Rules::generate_legal_moves(&s, 7, 4) {
        if m.special == SpecialMove::CastleKingside {
            mv = Some(m);
            break;
        }
    }
    let mut after = s.clone();
    Rules::apply_move(&mut after, mv.as_ref().unwrap(), true);
    check("短易位后白王位于 g1", after.board[7][6] == 'K');
    check("短易位后白车位于 f1", after.board[7][5] == 'R');
    check("短易位后 h1 为空", after.board[7][7] == '.');
    check("短易位后白方失去全部易位权", !after.can_castle_wk && !after.can_castle_wq);

    let mut blocked = s.clone();
    blocked.board[3][3] = 'r'; // 黑车 d5，攻击 d1
    let km = Rules::generate_legal_moves(&blocked, 7, 4);
    let mut castle_q_blocked = false;
    for m in &km {
        if m.special == SpecialMove::CastleQueenside {
            castle_q_blocked = true;
        }
    }
    check("路径 d1 被攻击时长易位被禁止", !castle_q_blocked);

    let mut in_check = s.clone();
    in_check.board[3][4] = 'r'; // 黑车 e5 攻击 e1
    let km = Rules::generate_legal_moves(&in_check, 7, 4);
    let mut any_castle = false;
    for m in &km {
        if m.special == SpecialMove::CastleKingside || m.special == SpecialMove::CastleQueenside {
            any_castle = true;
        }
    }
    check("王被将军时禁止易位", !any_castle);
}

// ---------- 5. 兵升变 ----------
fn test_promotion() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[1][4] = 'P';
    s.board[7][4] = 'K';
    s.board[0][7] = 'k';

    let moves = Rules::generate_legal_moves(&s, 1, 4);
    let mut promo_count = 0;
    for m in &moves {
        if m.special == SpecialMove::Promotion {
            promo_count += 1;
        }
    }
    check("e7 兵生成 4 种升变走法（Q/R/B/N）", promo_count == 4);

    let mut mv = None;
    for m in Rules::generate_legal_moves(&s, 1, 4) {
        if m.special == SpecialMove::Promotion && m.promotion == 'Q' {
            mv = Some(m);
            break;
        }
    }
    let mut after = s.clone();
    Rules::apply_move(&mut after, mv.as_ref().unwrap(), true);
    check("升变后 e8 为白后", after.board[0][4] == 'Q');
    check("升变后 e7 为空", after.board[1][4] == '.');
}

// ---------- 6. 学者将杀 ----------
fn test_scholar_mate() {
    let mut s = GameState::new();
    s = play(&s, 6, 4, 4, 4); // 1. e4
    s = play(&s, 1, 4, 3, 4); // 1... e5
    s = play(&s, 7, 5, 4, 2); // 2. Bf1-c4
    s = play(&s, 0, 1, 2, 2); // 2... Nb8-c6
    s = play(&s, 7, 3, 3, 7); // 3. Qd1-h5
    s = play(&s, 0, 6, 2, 5); // 3... Ng8-f6
    s = play(&s, 3, 7, 1, 5); // 4. Qh5xf7#

    check("学者将杀：黑方被将军", Rules::is_in_check(&s, false));
    check("学者将杀：IsCheckmate = True", Rules::is_checkmate(&s));
    check("学者将杀：非逼和", !Rules::is_stalemate(&s));
    check("学者将杀后轮黑方", !s.white_to_move);
}

// ---------- 7. 愚兄杀 ----------
fn test_fool_mate() {
    let mut s = GameState::new();
    s = play(&s, 6, 5, 5, 5); // 1. f3
    s = play(&s, 1, 4, 3, 4); // 1... e5
    s = play(&s, 6, 6, 4, 6); // 2. g4
    s = play(&s, 0, 3, 4, 7); // 2... Qd8-h4#

    check("愚兄杀：白方被将军", Rules::is_in_check(&s, true));
    check("愚兄杀：IsCheckmate = True", Rules::is_checkmate(&s));
}

// ---------- 8. 逼和 ----------
fn test_stalemate() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[0][7] = 'k';
    s.board[1][5] = 'Q';
    s.board[2][6] = 'K';
    s.white_to_move = false;

    check("逼和局面：黑方不被将军", !Rules::is_in_check(&s, false));
    check("逼和局面：黑方合法走法数 = 0", Rules::generate_all_legal_moves(&s).len() == 0);
    check("逼和局面：IsStalemate = True", Rules::is_stalemate(&s));
    check("逼和局面：非将死", !Rules::is_checkmate(&s));
}

// ---------- 9. 子力不足 ----------
fn test_insufficient_material() {
    let mut kk = GameState::new();
    empty_board(&mut kk);
    kk.board[7][4] = 'K';
    kk.board[0][4] = 'k';
    check("仅剩双王 = 子力不足", Rules::is_insufficient_material(&kk));

    kk.board[4][4] = 'N';
    check("王+单马 vs 王 = 子力不足", Rules::is_insufficient_material(&kk));

    kk.board[4][4] = 'b';
    check("王+单象 vs 王 = 子力不足", Rules::is_insufficient_material(&kk));

    kk.board[4][4] = 'P';
    check("王+兵 vs 王 ≠ 子力不足", !Rules::is_insufficient_material(&kk));

    kk.board[4][4] = 'R';
    check("王+车 vs 王 ≠ 子力不足", !Rules::is_insufficient_material(&kk));

    let full = GameState::new();
    check("初始局面 ≠ 子力不足", !Rules::is_insufficient_material(&full));
}

// ---------- 10. 50 步规则计数 ----------
fn test_fifty_move_counter() {
    let mut s = GameState::new();
    s = play(&s, 7, 6, 5, 5); // 1. Ng1-f3
    check("马走一步后半步计数 = 1", s.halfmove_clock == 1);
    s = play(&s, 0, 6, 2, 5); // 1... Ng8-f6
    check("两步非兵非吃后半步计数 = 2", s.halfmove_clock == 2);
    s = play(&s, 5, 5, 7, 6); // 2. Nf3-g1
    check("三步后半步计数 = 3", s.halfmove_clock == 3);
    s = play(&s, 2, 5, 0, 6); // 2... Nf6-g8
    check("四步后半步计数 = 4", s.halfmove_clock == 4);
    s = play(&s, 6, 4, 4, 4); // 3. e4（动兵清零）
    check("动兵后半步计数清零", s.halfmove_clock == 0);
    check("未达 100 半步不判 50 步和棋", !Rules::is_fifty_move_draw(&s));

    let mut forced = GameState::new();
    forced.halfmove_clock = 100;
    check("100 半步判 50 步和棋", Rules::is_fifty_move_draw(&forced));
}

// ---------- 11. 三次重复局面判和 ----------
fn test_threefold_repetition() {
    let mut s = GameState::new();
    s = play(&s, 7, 6, 5, 5);
    s = play(&s, 0, 6, 2, 5);
    s = play(&s, 5, 5, 7, 6);
    s = play(&s, 2, 5, 0, 6);
    check("4 步往返后局面重复第 2 次（不判和）", !Rules::is_threefold_repetition(&s));

    s = play(&s, 7, 6, 5, 5);
    s = play(&s, 0, 6, 2, 5);
    s = play(&s, 5, 5, 7, 6);
    s = play(&s, 2, 5, 0, 6);
    check("8 步往返后局面重复第 3 次（判和）", Rules::is_threefold_repetition(&s));

    s = play(&s, 6, 4, 4, 4);
    check("走出新局面后不再判和", !Rules::is_threefold_repetition(&s));
}

// ---------- 12. 评估函数 ----------
fn test_evaluation() {
    let mut s = GameState::new();
    check("初始局面评估 = 0（对称）", AIEngine::evaluate(&s) == 0);
    s.board[4][4] = 'P';
    let score1 = AIEngine::evaluate(&s);
    check("白方多一兵 → 评估为正", score1 > 0);
    s.board[3][3] = 'n';
    let score2 = AIEngine::evaluate(&s);
    check("黑方多一马压过白方一兵 → 评估为负", score2 < 0);
}

// ---------- 13. Negamax 终局评分 ----------
fn test_negamax_terminal_scores() {
    let mut s = GameState::new();
    s = play(&s, 6, 4, 4, 4);
    s = play(&s, 1, 4, 3, 4);
    s = play(&s, 7, 5, 4, 2);
    s = play(&s, 0, 1, 2, 2);
    s = play(&s, 7, 3, 3, 7);
    s = play(&s, 0, 6, 2, 5);
    s = play(&s, 3, 7, 1, 5); // 4. Qxf7#
    let mate_score = AIEngine::negamax(&s, 2, -AIEngine::INFINITY, AIEngine::INFINITY, 0);
    check("将死局面 negamax 返回大负数", mate_score <= -9000);

    let mut st = GameState::new();
    empty_board(&mut st);
    st.board[0][7] = 'k';
    st.board[1][5] = 'Q';
    st.board[2][6] = 'K';
    st.white_to_move = false;
    st.position_keys.clear();
    st.position_keys.push(st.get_position_key());
    let stale_score = AIEngine::negamax(&st, 2, -AIEngine::INFINITY, AIEngine::INFINITY, 0);
    check("逼和局面 negamax 返回 0", stale_score == 0);
}

// ---------- 14. AI 一步杀 ----------
fn test_ai_finds_mate() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[2][1] = 'K';
    s.board[7][7] = 'Q';
    s.board[0][0] = 'k';
    s.white_to_move = true;
    s.position_keys.clear();
    s.position_keys.push(s.get_position_key());

    let best = AIEngine::find_best_move(&s, 2);
    let mut after = s.clone();
    Rules::apply_move(&mut after, best.as_ref().unwrap(), true);
    check("AI 深度 2 找到一步杀（Qh8#）", Rules::is_checkmate(&after));
}

// ---------- 15. AI 白吃无保护后 ----------
fn test_ai_captures_free_queen() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][3] = 'Q';
    s.board[7][4] = 'K';
    s.board[0][3] = 'q';
    s.board[0][7] = 'k';
    s.white_to_move = true;
    s.position_keys.clear();
    s.position_keys.push(s.get_position_key());

    let best = AIEngine::find_best_move(&s, 2);
    let bm = best.as_ref().unwrap();
    check(
        "AI 深度 2 捕获无保护黑后",
        bm.to_row == 0 && bm.to_col == 3 && bm.captured == 'q',
    );
}

// ---------- 16. AI 开局合理性 ----------
fn test_ai_choose_reasonable_opening() {
    let s = GameState::new();
    let t0 = std::time::Instant::now();
    let best = AIEngine::find_best_move(&s, 2);
    let t1 = std::time::Instant::now();
    let mut is_legal = false;
    if let Some(best) = best {
        for m in Rules::generate_all_legal_moves(&s) {
            if m.from_row == best.from_row
                && m.from_col == best.from_col
                && m.to_row == best.to_row
                && m.to_col == best.to_col
            {
                is_legal = true;
            }
        }
    }
    check("初始局面 AI 返回合法走法", is_legal);
    let ms = (t1 - t0).as_millis();
    check("AI 深度 2 初始局面搜索 < 5 秒", ms < 5000);
}

// ---------- 17. 被钉死棋子限制 ----------
fn test_pinned_piece() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][3] = 'K';
    s.board[6][3] = 'B';
    s.board[0][3] = 'r';
    s.board[0][4] = 'k';
    check(
        "钉死前象存在伪合法走法",
        !Rules::generate_pseudo_moves(&s, 6, 3).is_empty(),
    );
    check("被钉死象无合法走法", Rules::generate_legal_moves(&s, 6, 3).is_empty());
    check("钉死局面白王未被将军", !Rules::is_in_check(&s, true));
}

// ---------- 18. 被将军时合法走法枚举 ----------
fn test_check_evasion() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][4] = 'K';
    s.board[0][4] = 'r';
    s.board[0][0] = 'k';
    check("逃将局面白王被将军", Rules::is_in_check(&s, true));
    let legal = Rules::generate_all_legal_moves(&s);
    check("被将军时合法走法均为逃着（>0）", !legal.is_empty());
    let mut all_resolve = true;
    for m in &legal {
        let mut after = s.clone();
        Rules::apply_move(&mut after, m, true);
        if Rules::is_in_check(&after, true) {
            all_resolve = false;
        }
    }
    check("每个合法走法均解除将军", all_resolve);
}

// ---------- 19. 过路兵吃子揭开己方王 ----------
fn test_en_passant_reveal_check() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[3][0] = 'K';
    s.board[3][7] = 'r';
    s.board[3][3] = 'P';
    s.board[3][4] = 'p';
    s.white_to_move = true;
    s.en_passant_row = 2;
    s.en_passant_col = 4;
    s.position_keys.clear();
    check("EP 揭开将军：当前白王未被将军", !Rules::is_in_check(&s, true));
    let legal = Rules::generate_legal_moves(&s, 3, 3);
    let mut has_ep = false;
    for m in &legal {
        if m.special == SpecialMove::EnPassant {
            has_ep = true;
        }
    }
    check("EP 吃子会揭开己方王 → 不出现在合法走法中", !has_ep);
}

// ---------- 20. 子力不足扩展 ----------
fn test_insufficient_material_extended() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][4] = 'K';
    s.board[0][4] = 'k';
    check("KK = 子力不足", Rules::is_insufficient_material(&s));
    s.board[7][1] = 'N';
    check("KN vs K = 子力不足", Rules::is_insufficient_material(&s));
    s.board[7][2] = 'N';
    check("KNN vs K = 子力不足", Rules::is_insufficient_material(&s));

    let mut kb = GameState::new();
    empty_board(&mut kb);
    kb.board[7][4] = 'K';
    kb.board[0][4] = 'k';
    kb.board[7][2] = 'B';
    kb.board[0][3] = 'b';
    check("KB vs KB = 子力不足", Rules::is_insufficient_material(&kb));

    let mut kbb = GameState::new();
    empty_board(&mut kbb);
    kbb.board[7][4] = 'K';
    kbb.board[0][4] = 'k';
    kbb.board[7][2] = 'B';
    kbb.board[7][5] = 'B';
    check("KBB 异色格双象可杀 ≠ 子力不足", !Rules::is_insufficient_material(&kbb));

    let mut kbn = GameState::new();
    empty_board(&mut kbn);
    kbn.board[7][4] = 'K';
    kbn.board[0][4] = 'k';
    kbn.board[7][2] = 'B';
    kbn.board[7][1] = 'N';
    check("KBN vs K 可杀 ≠ 子力不足", !Rules::is_insufficient_material(&kbn));

    let mut kr = GameState::new();
    empty_board(&mut kr);
    kr.board[7][4] = 'K';
    kr.board[0][4] = 'k';
    kr.board[7][0] = 'R';
    check("K + 车 vs K 可杀 ≠ 子力不足", !Rules::is_insufficient_material(&kr));
}

// ---------- 21. AI 深度 3 性能 ----------
fn test_depth3_timing() {
    let mut s = GameState::new();
    s = play(&s, 6, 4, 4, 4);
    s = play(&s, 1, 4, 3, 4);
    s = play(&s, 7, 6, 5, 5);
    s = play(&s, 0, 1, 2, 2);
    s = play(&s, 7, 5, 4, 2);
    s = play(&s, 0, 6, 2, 5);
    let t0 = std::time::Instant::now();
    let best = AIEngine::find_best_move(&s, 3);
    let t1 = std::time::Instant::now();
    let mut is_legal = false;
    if let Some(best) = best {
        for m in Rules::generate_all_legal_moves(&s) {
            if m.from_row == best.from_row
                && m.from_col == best.from_col
                && m.to_row == best.to_row
                && m.to_col == best.to_col
            {
                is_legal = true;
            }
        }
    }
    check("AI 深度 3 返回合法走法", is_legal);
    let ms = (t1 - t0).as_millis();
    check("AI 深度 3 中局搜索 < 2 秒", ms < 2000);
}

// ---------- 22. 角格车被吃后撤销易位权 ----------
fn test_castling_right_revoked_on_rook_capture() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[7][4] = 'K';
    s.board[7][7] = 'R';
    s.board[0][7] = 'r';
    s.board[0][4] = 'k';
    s.white_to_move = false;
    s.can_castle_wk = true;
    s.can_castle_wq = true;
    s.can_castle_bk = true;
    s.can_castle_bq = true;

    let mut mv = None;
    for m in Rules::generate_legal_moves(&s, 0, 7) {
        if m.to_row == 7 && m.to_col == 7 {
            mv = Some(m);
        }
    }
    check("黑车可走到 h1 吃掉白车", mv.is_some());
    let mut after = s.clone();
    Rules::apply_move(&mut after, mv.as_ref().unwrap(), true);
    check("角格白车被吃后白方失去短易位权", !after.can_castle_wk);
    check("黑车已占领 h1", after.board[7][7] == 'r');
}

// ---------- 23. 退化局面 ----------
fn test_degenerate_positions() {
    let mut empty = GameState::new();
    empty_board(&mut empty);
    check(
        "空盘 a1 不被攻击",
        !Rules::is_attacked(&empty.board, 7, 0, true)
            && !Rules::is_attacked(&empty.board, 7, 0, false),
    );
    check(
        "空盘 e4 不被攻击",
        !Rules::is_attacked(&empty.board, 4, 4, true)
            && !Rules::is_attacked(&empty.board, 4, 4, false),
    );

    let mut kk = GameState::new();
    empty_board(&mut kk);
    kk.board[7][4] = 'K';
    kk.board[0][4] = 'k';
    let bm = AIEngine::find_best_move(&kk, 1);
    check("K vs K 局面 FindBestMove 有值（王可走）", bm.is_some());

    let mut mate = GameState::new();
    mate = play(&mate, 6, 4, 4, 4);
    mate = play(&mate, 1, 4, 3, 4);
    mate = play(&mate, 7, 5, 4, 2);
    mate = play(&mate, 0, 1, 2, 2);
    mate = play(&mate, 7, 3, 3, 7);
    mate = play(&mate, 0, 6, 2, 5);
    mate = play(&mate, 3, 7, 1, 5); // Qxf7#
    let mate_move = AIEngine::find_best_move(&mate, 1);
    check("将死局面 FindBestMove = Nothing", mate_move.is_none());
}

// ---------- 24. 升变 SAN 记谱 ----------
fn test_promotion_san() {
    let mut s = GameState::new();
    empty_board(&mut s);
    s.board[1][4] = 'P';
    s.board[7][4] = 'K';
    s.board[0][7] = 'k';
    let mut qmove = None;
    for m in Rules::generate_legal_moves(&s, 1, 4) {
        if m.special == SpecialMove::Promotion && m.promotion == 'Q' {
            qmove = Some(m);
        }
    }
    check("升后走法存在", qmove.is_some());
    if let Some(qmove) = qmove {
        check("升变 SAN 含 =Q", qmove.to_string().contains("=Q"));
        check("升变 SAN = e8=Q", qmove.to_string() == "e8=Q");
    }
}

// 运行全部测试，返回失败数（0 = 全绿）
pub fn run_tests() -> i32 {
    *COUNTERS.lock().unwrap() = (0, 0);
    test_initial_position();
    test_is_attacked_basics();
    test_pawn_double_and_en_passant();
    test_castling();
    test_promotion();
    test_scholar_mate();
    test_fool_mate();
    test_stalemate();
    test_insufficient_material();
    test_fifty_move_counter();
    test_threefold_repetition();
    test_evaluation();
    test_negamax_terminal_scores();
    test_ai_finds_mate();
    test_ai_captures_free_queen();
    test_ai_choose_reasonable_opening();
    test_pinned_piece();
    test_check_evasion();
    test_en_passant_reveal_check();
    test_insufficient_material_extended();
    test_depth3_timing();
    test_castling_right_revoked_on_rook_capture();
    test_degenerate_positions();
    test_promotion_san();
    test_perft();

    let c = COUNTERS.lock().unwrap();
    println!("\n========================================");
    println!("RESULT: {} passed, {} failed", c.0, c.1);
    println!("========================================");
    c.1
}
