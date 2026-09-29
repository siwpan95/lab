// =============================================================================
// chess_ai.rs — AI 对弈引擎（Rust, 对齐 C++ chess_ai.h/.cpp）
// 架构：评估（子力 + PST）+ 搜索（negamax + alpha-beta + MVV-LVA + quiescence）
// =============================================================================

use crate::chess_core::{GameState, Move, Rules};

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

    // 主搜索：negamax + alpha-beta
    pub fn negamax(state: &GameState, depth: i32, alpha: i32, beta: i32, ply: i32) -> i32 {
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

    // 对外接口：求最佳走法（无合法走法时为 None）
    pub fn find_best_move(state: &GameState, depth: i32) -> Option<Move> {
        let moves = Rules::generate_all_legal_moves(state);
        if moves.is_empty() {
            return None;
        }
        if moves.len() == 1 {
            return Some(moves[0].clone());
        }
        let mut moves = moves;
        Self::order_moves(&mut moves);

        let mut best_move = moves[0].clone();
        let mut best_score = -Self::INFINITY;
        let mut alpha = -Self::INFINITY;
        let beta = Self::INFINITY;

        for m in &moves {
            let mut child = state.clone_light();
            Rules::apply_move(&mut child, m, false);
            let score = -Self::negamax(&child, depth - 1, -beta, -alpha, 1);
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
