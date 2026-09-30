// =============================================================================
// chess_ai.rs — AI 对弈引擎（Rust, 对齐 C++ chess_ai.h/.cpp）
// 架构：评估（子力 + PST）+ 搜索（negamax + alpha-beta + MVV-LVA + quiescence）
// =============================================================================

use crate::chess_core::{GameState, Move, Rules};
use std::cell::RefCell;
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
// 与 JsChess/chessAI.js 的 EVAL_PROFILE 同构：每引擎一份独立 profile，术语全部是
// 白黑严格镜像差值（初始对称局面评估仍为 0）。字段顺序与 profile_hash 的规范化串即契约，
// 验收门 tournament/validate_eval_profile.mjs 用同一 djb2-32 算法独立重算比对。
// mobilityWeight 为预留字段（0 = 关闭），试点只启用兵盾/兵形/双象三组术语。
pub const EVAL_PROFILE_NAME: &str = "materialist";
const EVAL_PAWN_SHIELD_MISSING: i32 = 8;  // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
const EVAL_PAWN_SHIELD_OPEN_FILE: i32 = 4; // 王自家线在王前方已无任何己方兵
const EVAL_DOUBLED_PAWN: i32 = 6;          // 每个叠兵（同线多出的每一个）
const EVAL_ISOLATED_PAWN: i32 = 8;         // 每个孤兵（相邻线无己方兵）
const EVAL_PASSED_PAWN_BASE: i32 = 12;     // 通路兵基础分
const EVAL_PASSED_PAWN_PER_RANK: i32 = 4;  // 通路兵每向升变推进一行的加成
const EVAL_BISHOP_PAIR: i32 = 10;          // 双象
const EVAL_MOBILITY_WEIGHT: i32 = 0;       // 预留：机动性每步权重（试点关闭）

// profile_hash：profile 规范化串的 djb2-32，与 JS 侧 evalProfileHash 逐字节同算法。
// 规范化串 = 各字段以 '|' 连接（整数无空格），字段顺序即哈希契约。
pub fn profile_hash() -> String {
    let s = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        EVAL_PROFILE_NAME,
        EVAL_PAWN_SHIELD_MISSING,
        EVAL_PAWN_SHIELD_OPEN_FILE,
        EVAL_DOUBLED_PAWN,
        EVAL_ISOLATED_PAWN,
        EVAL_PASSED_PAWN_BASE,
        EVAL_PASSED_PAWN_PER_RANK,
        EVAL_BISHOP_PAIR,
        EVAL_MOBILITY_WEIGHT
    );
    let mut h: u32 = 5381;
    for b in s.as_bytes() {
        h = h.wrapping_mul(33).wrapping_add(*b as u32);
    }
    format!("{:08x}", h)
}

// ---------------------------- 子力价值（厘兵单位） ----------------------------
// 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
const PIECE_VALUE: [i32; 7] = [0, 100, 320, 330, 500, 900, 0];

// ---------------------------- 位置价值表 PST（白方视角，row0..row7，a..h） ----------------------------
const PST_PAWN: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_KNIGHT: [i32; 64] = [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
];
const PST_BISHOP: [i32; 64] = [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
];
const PST_ROOK: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0,
    0, 5, 5, 0, 0, 0,
];
const PST_QUEEN: [i32; 64] = [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
];
const PST_KING: [i32; 64] = [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
];

// ---------------------------- Tier 2-B 时间控制 ----------------------------
// 迭代加深 + 软/硬双阈值（与 Go chess_ai.go 的 searchClock、JsChess 的 SearchClock 同构）：
//   · 软阈值：开新一轮深度前检查（已用时间 >= 预算×1/2 就不再开新轮）；
//   · 硬阈值：搜索中每 NODES_PER_TIME_CHECK 个节点检查一次，超限置 aborted；
//     被中断的那一轮**结果作废**，只采用上一轮完整深度的结果，
//     从而保证返回的着法始终来自一次完整搜索。
// time_ms <= 0 时时钟为 None，完全不启用（走原固定深度路径，行为与改造前一致）。
const NODES_PER_TIME_CHECK: i64 = 2048;
const SOFT_NUMERATOR: i64 = 1;
const SOFT_DENOMINATOR: i64 = 2; // 软阈值 = 预算 × 1/2

struct SearchClock {
    limit_ms: i64,
    start_ms: i64,
    soft_ms: i64,
    nodes: i64,
    aborted: bool,
}

thread_local! {
    // 当前搜索的时钟（无时间控制时为 None）。驱动是单线程的，用 thread_local
    // 避免全局可变静态的 unsafe，也无锁开销。
    // 注意：所有访问器都在返回前释放 RefCell 借用，绝不在持有借用时递归进搜索。
    static CLOCK: RefCell<Option<SearchClock>> = RefCell::new(None);
}

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => 0,
    }
}

// begin_clock 启动（time_ms>0）或关闭（time_ms<=0）时间控制。
fn begin_clock(time_ms: i64) {
    CLOCK.with(|c| {
        if time_ms <= 0 {
            *c.borrow_mut() = None;
            return;
        }
        let now = now_ms();
        *c.borrow_mut() = Some(SearchClock {
            limit_ms: time_ms,
            start_ms: now,
            soft_ms: now + time_ms * SOFT_NUMERATOR / SOFT_DENOMINATOR,
            nodes: 0,
            aborted: false,
        });
    });
}

// clock_end 结束本次受控搜索，时钟置空（避免泄漏到后续 negamax 调用）。
fn clock_end() {
    CLOCK.with(|c| {
        c.replace(None);
    });
}

// clock_tick 每 NODES_PER_TIME_CHECK 个节点查一次硬阈值；返回是否已中断。
fn clock_tick() -> bool {
    CLOCK.with(|c| {
        let mut b = c.borrow_mut();
        match b.as_mut() {
            None => false,
            Some(cl) => {
                cl.nodes += 1;
                if cl.nodes % NODES_PER_TIME_CHECK == 0 && now_ms() - cl.start_ms >= cl.limit_ms {
                    cl.aborted = true;
                }
                cl.aborted
            }
        }
    })
}

// clock_over_soft 软阈值：是否不该再开新一轮深度。
fn clock_over_soft() -> bool {
    CLOCK.with(|c| match c.borrow().as_ref() {
        None => false,
        Some(cl) => now_ms() >= cl.soft_ms,
    })
}

// clock_aborted 当前这一轮是否已被硬阈值中断。
fn clock_aborted() -> bool {
    CLOCK.with(|c| c.borrow().as_ref().map_or(false, |cl| cl.aborted))
}

// clock_reset_abort 开新一轮深度前清掉上一轮的中断标记。
fn clock_reset_abort() {
    CLOCK.with(|c| {
        if let Some(cl) = c.borrow_mut().as_mut() {
            cl.aborted = false;
        }
    });
}

pub struct AIEngine;

impl AIEngine {
    pub const MATE_SCORE: i32 = 900000;
    pub const INFINITY: i32 = 1000000;
    // RepetitionPenalty：当某个叶局面的 engine.mjs 兼容键出现在 RepHistory（本局
    // 此前见过的局面）中时，按出现次数扣分（白方视角）。目的是引导搜索远离会把
    // 对局带回重复局面的走法，从而减少三重复和棋。取值约半兵，足够影响平手选择、
    // 又不至于让引擎为了避重而白白弃子。
    pub const REPETITION_PENALTY: i32 = 60;

    fn piece_index(p: char) -> i32 {
        match p.to_ascii_uppercase() {
            'P' => 1,
            'N' => 2,
            'B' => 3,
            'R' => 4,
            'Q' => 5,
            'K' => 6,
            _ => 0,
        }
    }

    fn get_pst(idx: i32, pos: i32) -> i32 {
        match idx {
            1 => PST_PAWN[pos as usize],
            2 => PST_KNIGHT[pos as usize],
            3 => PST_BISHOP[pos as usize],
            4 => PST_ROOK[pos as usize],
            5 => PST_QUEEN[pos as usize],
            6 => PST_KING[pos as usize],
            _ => 0,
        }
    }

    // 局面评估（白方视角：正 = 白方占优）
    pub fn evaluate(state: &GameState) -> i32 {
        let mut score = 0;
        for r in 0..8 {
            for c in 0..8 {
                let p = state.board[r][c];
                if p == '.' {
                    continue;
                }
                let idx = Self::piece_index(p);
                let pos = (r * 8 + c) as i32;
                if p.is_ascii_uppercase() {
                    score += PIECE_VALUE[idx as usize] + Self::get_pst(idx, pos);
                } else {
                    score -= PIECE_VALUE[idx as usize] + Self::get_pst(idx, ((7 - r) * 8 + c) as i32);
                }
            }
        }
        // Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
        // 保持「初始局面评估 = 0」的对称性不变量。
        score += Self::pawn_structure_score(state);
        score += Self::king_safety_score(state);
        score += Self::bishop_pair_score(state);
        // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if let Some(rep) = &state.rep_history {
            let key = state.position_key_simple();
            if let Some(&cnt) = rep.get(&key) {
                if cnt > 0 {
                    score -= Self::REPETITION_PENALTY * cnt;
                }
            }
        }
        score
    }

    // 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
    fn pawn_structure_score(state: &GameState) -> i32 {
        let b = &state.board;
        let mut w_cnt = [0i32; 8];
        let mut b_cnt = [0i32; 8];
        let mut w_pawns: Vec<(usize, usize)> = Vec::new();
        let mut b_pawns: Vec<(usize, usize)> = Vec::new();
        for r in 0..8usize {
            for c in 0..8usize {
                if b[r][c] == 'P' {
                    w_cnt[c] += 1;
                    w_pawns.push((r, c));
                } else if b[r][c] == 'p' {
                    b_cnt[c] += 1;
                    b_pawns.push((r, c));
                }
            }
        }
        let mut score = 0;
        for c in 0..8usize {
            if w_cnt[c] > 1 {
                score -= EVAL_DOUBLED_PAWN * (w_cnt[c] - 1);
            }
            if b_cnt[c] > 1 {
                score += EVAL_DOUBLED_PAWN * (b_cnt[c] - 1);
            }
        }
        for &(r, c) in &w_pawns {
            let isolated = (c == 0 || w_cnt[c - 1] == 0) && (c == 7 || w_cnt[c + 1] == 0);
            if isolated {
                score -= EVAL_ISOLATED_PAWN;
            }
            let mut passed = true;
            for f in (c as i32 - 1)..=(c as i32 + 1) {
                if !(0..=7).contains(&f) {
                    continue;
                }
                let f = f as usize;
                let mut rr = r as i32 - 1;
                while rr >= 0 {
                    if b[rr as usize][f] == 'p' {
                        passed = false;
                        break;
                    }
                    rr -= 1;
                }
                if !passed {
                    break;
                }
            }
            if passed {
                score += EVAL_PASSED_PAWN_BASE + EVAL_PASSED_PAWN_PER_RANK * (6 - r as i32);
            }
        }
        for &(r, c) in &b_pawns {
            let isolated = (c == 0 || b_cnt[c - 1] == 0) && (c == 7 || b_cnt[c + 1] == 0);
            if isolated {
                score += EVAL_ISOLATED_PAWN;
            }
            let mut passed = true;
            for f in (c as i32 - 1)..=(c as i32 + 1) {
                if !(0..=7).contains(&f) {
                    continue;
                }
                let f = f as usize;
                let mut rr = r as i32 + 1;
                while rr <= 7 {
                    if b[rr as usize][f] == 'P' {
                        passed = false;
                        break;
                    }
                    rr += 1;
                }
                if !passed {
                    break;
                }
            }
            if passed {
                score -= EVAL_PASSED_PAWN_BASE + EVAL_PASSED_PAWN_PER_RANK * (r as i32 - 1);
            }
        }
        score
    }

    // 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
    fn king_safety_score(state: &GameState) -> i32 {
        let b = &state.board;
        let mut wk: Option<(usize, usize)> = None;
        let mut bk: Option<(usize, usize)> = None;
        for r in 0..8usize {
            for c in 0..8usize {
                if b[r][c] == 'K' {
                    wk = Some((r, c));
                } else if b[r][c] == 'k' {
                    bk = Some((r, c));
                }
            }
        }
        let (wk, bk) = match (wk, bk) {
            (Some(w), Some(bl)) => (w, bl),
            _ => return 0,
        };
        let mut score = 0;
        if wk.0 >= 6 {
            let kr = wk.0 as i32;
            let kc = wk.1 as i32;
            for c in (kc - 1)..=(kc + 1) {
                if !(0..=7).contains(&c) {
                    continue;
                }
                if b[(kr - 1) as usize][c as usize] != 'P' {
                    score -= EVAL_PAWN_SHIELD_MISSING;
                }
            }
            let mut shielded = false;
            let mut r = kr - 1;
            while r >= 0 {
                if b[r as usize][wk.1] == 'P' {
                    shielded = true;
                    break;
                }
                r -= 1;
            }
            if !shielded {
                score -= EVAL_PAWN_SHIELD_OPEN_FILE;
            }
        }
        if bk.0 <= 1 {
            let kr = bk.0 as i32;
            let kc = bk.1 as i32;
            for c in (kc - 1)..=(kc + 1) {
                if !(0..=7).contains(&c) {
                    continue;
                }
                if b[(kr + 1) as usize][c as usize] != 'p' {
                    score += EVAL_PAWN_SHIELD_MISSING;
                }
            }
            let mut shielded = false;
            let mut r = kr + 1;
            while r <= 7 {
                if b[r as usize][bk.1] == 'p' {
                    shielded = true;
                    break;
                }
                r += 1;
            }
            if !shielded {
                score += EVAL_PAWN_SHIELD_OPEN_FILE;
            }
        }
        score
    }

    // 双象分（白方视角差值）。
    fn bishop_pair_score(state: &GameState) -> i32 {
        let b = &state.board;
        let mut wb = 0;
        let mut bb = 0;
        for r in 0..8usize {
            for c in 0..8usize {
                if b[r][c] == 'B' {
                    wb += 1;
                } else if b[r][c] == 'b' {
                    bb += 1;
                }
            }
        }
        let mut score = 0;
        if wb >= 2 {
            score += EVAL_BISHOP_PAIR;
        }
        if bb >= 2 {
            score -= EVAL_BISHOP_PAIR;
        }
        score
    }

    fn move_order_score(m: &Move) -> i32 {
        if m.captured == '.' {
            return 0;
        }
        let victim = PIECE_VALUE[Self::piece_index(m.captured) as usize];
        let attacker = PIECE_VALUE[Self::piece_index(m.piece) as usize];
        victim * 10 - attacker
    }

    fn order_moves(moves: &mut Vec<Move>) {
        moves.sort_by(|a, b| Self::move_order_score(b).cmp(&Self::move_order_score(a)));
    }

    // 静态搜索（quiescence）
    pub fn quiescence(state: &GameState, alpha: i32, beta: i32, qdepth: i32) -> i32 {
        // Tier 2-B：同 negamax，途中按节点数检查硬阈值。
        if clock_tick() {
            return alpha;
        }
        let stand = evaluate_side(state);
        let mut alpha = alpha;
        if stand >= beta {
            return beta;
        }
        if stand > alpha {
            alpha = stand;
        }
        if qdepth >= 4 {
            return alpha;
        }

        let mut captures = Vec::new();
        for m in Rules::generate_all_legal_moves(state) {
            if m.captured != '.' {
                captures.push(m);
            }
        }
        Self::order_moves(&mut captures);

        for m in &captures {
            let mut child = state.clone_light();
            Rules::apply_move(&mut child, m, false);
            let score = -Self::quiescence(&child, -beta, -alpha, qdepth + 1);
            if score >= beta {
                return beta;
            }
            if score > alpha {
                alpha = score;
            }
        }
        alpha
    }

    // 根结点一轮搜索（给定深度），返回最佳走法。
    // 硬阈值中断时立即跳出（本轮结果作废，由调用方丢弃）。
    fn search_root(state: &GameState, moves: &mut Vec<Move>, depth: i32) -> Option<Move> {
        if moves.is_empty() {
            return None;
        }
        Self::order_moves(moves);
        let mut best_move = moves[0].clone();
        let mut best_score = -Self::INFINITY;
        let mut alpha = -Self::INFINITY;
        let beta = Self::INFINITY;

        for m in moves.iter() {
            let mut child = state.clone_light();
            Rules::apply_move(&mut child, m, false);
            let score = -Self::negamax(&child, depth - 1, -beta, -alpha, 1);
            if clock_aborted() {
                break; // 硬阈值中断：本轮作废
            }
            if score > best_score {
                best_score = score;
                best_move = m.clone();
            }
            if score > alpha {
                alpha = score;
            }
        }
        Some(best_move)
    }

    // 主搜索：negamax + alpha-beta
    pub fn negamax(state: &GameState, depth: i32, alpha: i32, beta: i32, ply: i32) -> i32 {
        // Tier 2-B：硬阈值按节点数周期检查，超限立即中断（未完成的一轮会被丢弃）。
        if clock_tick() {
            return alpha;
        }
        let mut moves = Rules::generate_all_legal_moves(state);
        if moves.is_empty() {
            if Rules::is_in_check(state, state.white_to_move) {
                return -Self::MATE_SCORE + ply; // 被将死：离根越近越差
            }
            return 0; // 逼和
        }
        if depth <= 0 {
            return Self::quiescence(state, alpha, beta, 0);
        }
        Self::order_moves(&mut moves);

        let mut best = -Self::INFINITY;
        let mut alpha = alpha;
        for m in &moves {
            let mut child = state.clone_light();
            Rules::apply_move(&mut child, m, false);
            let score = -Self::negamax(&child, depth - 1, -beta, -alpha, ply + 1);
            if score > best {
                best = score;
            }
            if best > alpha {
                alpha = best;
            }
            if alpha >= beta {
                break;
            }
        }
        best
    }

    // 对外接口：求最佳走法（无合法走法时为 None）。
    // time_ms > 0 时启用 Tier 2-B 时间控制（迭代加深 + 软/硬双阈值）；
    // time_ms <= 0 时走原来的固定深度单次搜索，结果与改造前逐字节一致。
    pub fn find_best_move_timed(state: &GameState, depth: i32, time_ms: i32) -> Option<Move> {
        let mut moves = Rules::generate_all_legal_moves(state);
        if moves.is_empty() {
            return None;
        }
        if moves.len() == 1 {
            return Some(moves[0].clone());
        }
        // 迭代加深的深度上限。注意：无时间控制分支仍按调用方给定的 depth 原样搜索
        // （不套用 cap），以保证 timeMs=0 的结果与改造前完全一致。
        let cap = if depth > 0 { depth } else { 3 };

        if time_ms <= 0 || cap <= 1 {
            // 原路径：固定深度单次搜索（不含任何时钟开销）
            let prev = CLOCK.with(|c| c.replace(None));
            let res = Self::search_root(state, &mut moves, depth);
            CLOCK.with(|c| {
                c.replace(prev);
            });
            return res;
        }

        // 迭代加深：d = 1..cap，软阈值管“是否开新一轮”，硬阈值管“中断当前轮”。
        begin_clock(time_ms as i64);
        let mut best_move = moves[0].clone();
        let mut completed = false; // 是否已至少完整完成一轮（中断时回退到它）
        for d in 1..=cap {
            if completed && clock_over_soft() {
                break;
            }
            clock_reset_abort();
            let mut round = moves.clone();
            if let Some(mv) = Self::search_root(state, &mut round, d) {
                if clock_aborted() && completed {
                    break; // 丢弃未完成的这一轮
                }
                best_move = mv;
                completed = true;
            } else {
                break;
            }
        }
        clock_end();
        Some(best_move) // 至少完成过 depth=1 的一轮，必为合法着法
    }

    // 无时间控制的固定深度搜索（保持原有调用约定，等价于 find_best_move_timed(.., 0)）。
    pub fn find_best_move(state: &GameState, depth: i32) -> Option<Move> {
        Self::find_best_move_timed(state, depth, 0)
    }
}

// 当前行棋方视角分数（negamax 约定）
fn evaluate_side(state: &GameState) -> i32 {
    let s = AIEngine::evaluate(state);
    if state.white_to_move {
        s
    } else {
        -s
    }
}
