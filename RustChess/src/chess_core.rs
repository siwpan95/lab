// =============================================================================
// chess_core.rs — 国际象棋核心引擎（Rust, 对齐 C++ chess_core.h/.cpp）
// 架构：GameState（数据） + Rules（规则，关联函数集合）
//   规则：GeneratePseudoMoves -> 副本 ApplyMove -> IsAttacked 过滤送王着法
// =============================================================================

use std::collections::HashMap;
use std::rc::Rc;

// ---------------------------- 特殊走法类型 ----------------------------
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SpecialMove {
    None = 0,
    DoublePawn = 1,    // 兵双重进兵
    EnPassant = 2,     // 吃过路兵
    CastleKingside = 3,// 短易位
    CastleQueenside = 4,// 长易位
    Promotion = 5,     // 兵升变
}

// ---------------------------- 走法结构 ----------------------------
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Move {
    pub from_row: i32,
    pub from_col: i32,
    pub to_row: i32,
    pub to_col: i32,
    pub piece: char,     // 走动的棋子
    pub captured: char,  // 被吃棋子（'.'=未吃；过路兵填被吃兵）
    pub special: SpecialMove,
    pub promotion: char, // 升变目标棋子
}

impl Move {
    pub fn is_capture(&self) -> bool {
        self.captured != '.'
    }

    // 长式代数记谱（无歧义），与 C++ Move::toString 完全一致
    pub fn to_string(&self) -> String {
        if self.special == SpecialMove::CastleKingside {
            return "O-O".to_string();
        }
        if self.special == SpecialMove::CastleQueenside {
            return "O-O-O".to_string();
        }
        let files = "abcdefgh";
        let from_sq = format!(
            "{}{}",
            files.chars().nth(self.from_col as usize).unwrap(),
            8 - self.from_row
        );
        let to_sq = format!(
            "{}{}",
            files.chars().nth(self.to_col as usize).unwrap(),
            8 - self.to_row
        );
        if self.piece == 'P' || self.piece == 'p' {
            let mut s = String::new();
            if self.is_capture() {
                s.push(files.chars().nth(self.from_col as usize).unwrap());
            }
            s.push_str(&to_sq);
            if self.special == SpecialMove::Promotion {
                s.push('=');
                s.push(self.promotion.to_ascii_uppercase());
            }
            s
        } else {
            let mut s = String::new();
            s.push(self.piece.to_ascii_uppercase());
            s.push_str(&from_sq);
            if self.is_capture() {
                s.push('x');
            }
            s.push_str(&to_sq);
            s
        }
    }
}

// ---------------------------- 对局状态 ----------------------------
#[derive(Clone)]
pub struct GameState {
    pub board: [[char; 8]; 8],
    pub white_to_move: bool,
    pub can_castle_wk: bool,
    pub can_castle_wq: bool,
    pub can_castle_bk: bool,
    pub can_castle_bq: bool,
    pub en_passant_row: i32,
    pub en_passant_col: i32,
    pub halfmove_clock: i32,
    pub fullmove_number: i32,
    pub history: Vec<String>,
    pub position_keys: Vec<String>,
    // RepHistory: runner-supplied position keys seen so far this game (engine.mjs
    // keys), used by the repetition penalty in chess_ai.rs. None ⇒ no penalty.
    // Stored as Rc so Clone/CloneLight share the map without deep-copying it;
    // the search never mutates it.
    pub rep_history: Option<Rc<HashMap<String, i32>>>,
}

impl GameState {
    pub fn new() -> GameState {
        let mut s = GameState {
            board: [['.'; 8]; 8],
            white_to_move: true,
            can_castle_wk: true,
            can_castle_wq: true,
            can_castle_bk: true,
            can_castle_bq: true,
            en_passant_row: -1,
            en_passant_col: -1,
            halfmove_clock: 0,
            fullmove_number: 1,
            history: Vec::new(),
            position_keys: Vec::new(),
            rep_history: None,
        };
        s.reset_to_start_position();
        s
    }

    pub fn reset_to_start_position(&mut self) {
        let back = "rnbqkbnr";
        for c in 0..8 {
            self.board[0][c] = back.as_bytes()[c] as char;
            self.board[1][c] = 'p';
            self.board[2][c] = '.';
            self.board[3][c] = '.';
            self.board[4][c] = '.';
            self.board[5][c] = '.';
            self.board[6][c] = 'P';
            self.board[7][c] = (back.as_bytes()[c] as char).to_ascii_uppercase();
        }
        self.white_to_move = true;
        self.can_castle_wk = true;
        self.can_castle_wq = true;
        self.can_castle_bk = true;
        self.can_castle_bq = true;
        self.en_passant_row = -1;
        self.en_passant_col = -1;
        self.halfmove_clock = 0;
        self.fullmove_number = 1;
        self.history.clear();
        self.position_keys.clear();
        self.position_keys.push(self.get_position_key());
    }

    // PositionKeySimple：与 engine.mjs 的 getPositionKey 完全一致的局面键：
    //   · 易位权不加 '-' 分隔符（KQkq 直接拼接）
    //   · 过路兵用存储值（en_passant_row/col），不调用 has_legal_en_passant
    // 重复惩罚在评估层比对 runner 传来的历史键（也是 engine.mjs 键），
    // 所以必须保证两边键格式一致，否则惩罚永远不会触发。
    pub fn position_key_simple(&self) -> String {
        let mut s = String::with_capacity(90);
        for r in 0..8 {
            for c in 0..8 {
                s.push(self.board[r][c]);
            }
        }
        s.push(if self.white_to_move { 'w' } else { 'b' });
        if self.can_castle_wk {
            s.push('K');
        }
        if self.can_castle_wq {
            s.push('Q');
        }
        if self.can_castle_bk {
            s.push('k');
        }
        if self.can_castle_bq {
            s.push('q');
        }
        if self.en_passant_row >= 0 && self.en_passant_col >= 0 {
            s.push_str(&format!("{},{}", self.en_passant_row, self.en_passant_col));
        } else {
            s.push_str("-1,-1");
        }
        s
    }

    // 局面键：影响重复判定的全部状态
    pub fn get_position_key(&self) -> String {
        let mut s = String::with_capacity(90);
        for r in 0..8 {
            for c in 0..8 {
                s.push(self.board[r][c]);
            }
        }
        s.push(if self.white_to_move { 'w' } else { 'b' });
        s.push(if self.can_castle_wk { 'K' } else { '-' });
        s.push(if self.can_castle_wq { 'Q' } else { '-' });
        s.push(if self.can_castle_bk { 'k' } else { '-' });
        s.push(if self.can_castle_bq { 'q' } else { '-' });
        if Rules::has_legal_en_passant(self) {
            s.push_str(&format!("{},{}", self.en_passant_row, self.en_passant_col));
        } else {
            s.push_str("-1,-1");
        }
        s
    }

    // 轻量克隆（AI 搜索专用：跳过记谱与局面键）
    pub fn clone_light(&self) -> GameState {
        GameState {
            board: self.board,
            white_to_move: self.white_to_move,
            can_castle_wk: self.can_castle_wk,
            can_castle_wq: self.can_castle_wq,
            can_castle_bk: self.can_castle_bk,
            can_castle_bq: self.can_castle_bq,
            en_passant_row: self.en_passant_row,
            en_passant_col: self.en_passant_col,
            halfmove_clock: self.halfmove_clock,
            fullmove_number: self.fullmove_number,
            history: Vec::new(),
            position_keys: Vec::new(),
            rep_history: self.rep_history.clone(), // shared read-only during search
        }
    }
}

// ---------------------------- 规则引擎 ----------------------------
pub struct Rules;

impl Rules {
    // ===== 基础工具 =====
    pub fn in_board(r: i32, c: i32) -> bool {
        r >= 0 && r <= 7 && c >= 0 && c <= 7
    }
    pub fn is_white_piece(p: char) -> bool {
        p != '.' && p.is_ascii_uppercase()
    }
    pub fn is_black_piece(p: char) -> bool {
        p != '.' && p.is_ascii_lowercase()
    }
    pub fn is_piece_of_side(p: char, white: bool) -> bool {
        if p == '.' {
            return false;
        }
        if white {
            p.is_ascii_uppercase()
        } else {
            p.is_ascii_lowercase()
        }
    }

    // ===== IsAttacked：单一例程支撑整个规则库 =====
    pub fn is_attacked(board: &[[char; 8]; 8], r: i32, c: i32, by_white: bool) -> bool {
        // 1. 兵攻击
        let pawn = if by_white { 'P' } else { 'p' };
        let pr = if by_white { r + 1 } else { r - 1 };
        if Self::in_board(pr, c - 1) && board[pr as usize][(c - 1) as usize] == pawn {
            return true;
        }
        if Self::in_board(pr, c + 1) && board[pr as usize][(c + 1) as usize] == pawn {
            return true;
        }

        // 2. 马攻击
        let knight = if by_white { 'N' } else { 'n' };
        let dr2 = [-2, -2, -1, -1, 1, 1, 2, 2];
        let dc2 = [-1, 1, -2, 2, -2, 2, -1, 1];
        for i in 0..8 {
            let tr = r + dr2[i];
            let tc = c + dc2[i];
            if Self::in_board(tr, tc) && board[tr as usize][tc as usize] == knight {
                return true;
            }
        }

        // 3. 王攻击
        let king = if by_white { 'K' } else { 'k' };
        for dr in -1..=1 {
            for dc in -1..=1 {
                if dr == 0 && dc == 0 {
                    continue;
                }
                let tr = r + dr;
                let tc = c + dc;
                if Self::in_board(tr, tc) && board[tr as usize][tc as usize] == king {
                    return true;
                }
            }
        }

        // 4. 滑动射线：直线（前4）+ 斜线（后4）
        let rook = if by_white { 'R' } else { 'r' };
        let queen = if by_white { 'Q' } else { 'q' };
        let bishop = if by_white { 'B' } else { 'b' };
        let dir_r = [-1, 1, 0, 0, -1, -1, 1, 1];
        let dir_c = [0, 0, -1, 1, -1, 1, -1, 1];
        for i in 0..8 {
            let mut tr = r + dir_r[i];
            let mut tc = c + dir_c[i];
            while Self::in_board(tr, tc) {
                let p = board[tr as usize][tc as usize];
                if p != '.' {
                    if i < 4 {
                        if p == rook || p == queen {
                            return true;
                        }
                    } else if p == bishop || p == queen {
                        return true;
                    }
                    break;
                }
                tr += dir_r[i];
                tc += dir_c[i];
            }
        }
        false
    }

    // ===== 兵走法 =====
    fn gen_pawn_moves(
        list: &mut Vec<Move>,
        state: &GameState,
        r: i32,
        c: i32,
        is_white: bool,
        enemy_pawn: char,
    ) {
        let b = &state.board;
        let dir = if is_white { -1 } else { 1 };
        let start_row = if is_white { 6 } else { 1 };

        if Self::in_board(r + dir, c) && b[(r + dir) as usize][c as usize] == '.' {
            Self::add_pawn_move(list, r, c, r + dir, c, '.', SpecialMove::None, is_white);
            if r == start_row && b[(r + 2 * dir) as usize][c as usize] == '.' {
                list.push(Move {
                    from_row: r,
                    from_col: c,
                    to_row: r + 2 * dir,
                    to_col: c,
                    piece: b[r as usize][c as usize],
                    captured: '.',
                    special: SpecialMove::DoublePawn,
                    promotion: '.',
                });
            }
        }

        for dc in [-1, 1] {
            let tr = r + dir;
            let tc = c + dc;
            if !Self::in_board(tr, tc) {
                continue;
            }
            let target = b[tr as usize][tc as usize];
            if target != '.' && Self::is_piece_of_side(target, !is_white) {
                Self::add_pawn_move(list, r, c, tr, tc, target, SpecialMove::None, is_white);
            } else if tr == state.en_passant_row && tc == state.en_passant_col {
                Self::add_pawn_move(list, r, c, tr, tc, enemy_pawn, SpecialMove::EnPassant, is_white);
            }
        }
    }

    fn add_pawn_move(
        list: &mut Vec<Move>,
        fr: i32,
        fc: i32,
        tr: i32,
        tc: i32,
        captured: char,
        special: SpecialMove,
        is_white: bool,
    ) {
        if tr == 0 || tr == 7 {
            let promos = "QRBN";
            for ch in promos.chars() {
                list.push(Move {
                    from_row: fr,
                    from_col: fc,
                    to_row: tr,
                    to_col: tc,
                    piece: if is_white { 'P' } else { 'p' },
                    captured,
                    special: SpecialMove::Promotion,
                    promotion: if is_white { ch } else { ch.to_ascii_lowercase() },
                });
            }
        } else {
            list.push(Move {
                from_row: fr,
                from_col: fc,
                to_row: tr,
                to_col: tc,
                piece: if is_white { 'P' } else { 'p' },
                captured,
                special,
                promotion: '.',
            });
        }
    }

    // ===== 马/王固定偏移 =====
    fn gen_offset_moves(
        list: &mut Vec<Move>,
        board: &[[char; 8]; 8],
        r: i32,
        c: i32,
        is_white: bool,
        dr: &[i32],
        dc: &[i32],
    ) {
        let p = board[r as usize][c as usize];
        let n = dr.len();
        for i in 0..n {
            let tr = r + dr[i];
            let tc = c + dc[i];
            if !Self::in_board(tr, tc) {
                continue;
            }
            let target = board[tr as usize][tc as usize];
            if target == '.' || Self::is_piece_of_side(target, !is_white) {
                list.push(Move {
                    from_row: r,
                    from_col: c,
                    to_row: tr,
                    to_col: tc,
                    piece: p,
                    captured: target,
                    special: SpecialMove::None,
                    promotion: '.',
                });
            }
        }
    }

    // ===== 象/车/后滑动 =====
    fn gen_sliding_moves(
        list: &mut Vec<Move>,
        board: &[[char; 8]; 8],
        r: i32,
        c: i32,
        is_white: bool,
        dr: &[i32],
        dc: &[i32],
    ) {
        let p = board[r as usize][c as usize];
        let n = dr.len();
        for i in 0..n {
            let mut tr = r + dr[i];
            let mut tc = c + dc[i];
            while Self::in_board(tr, tc) {
                let target = board[tr as usize][tc as usize];
                if target == '.' {
                    list.push(Move {
                        from_row: r,
                        from_col: c,
                        to_row: tr,
                        to_col: tc,
                        piece: p,
                        captured: '.',
                        special: SpecialMove::None,
                        promotion: '.',
                    });
                } else {
                    if Self::is_piece_of_side(target, !is_white) {
                        list.push(Move {
                            from_row: r,
                            from_col: c,
                            to_row: tr,
                            to_col: tc,
                            piece: p,
                            captured: target,
                            special: SpecialMove::None,
                            promotion: '.',
                        });
                    }
                    break;
                }
                tr += dr[i];
                tc += dc[i];
            }
        }
    }

    // ===== 王车易位 =====
    fn gen_castling_moves(list: &mut Vec<Move>, state: &GameState, r: i32, c: i32, is_white: bool) {
        let b = &state.board;
        if is_white {
            if r != 7 || c != 4 {
                return;
            }
            if state.can_castle_wk && b[7][7] == 'R' && b[7][5] == '.' && b[7][6] == '.' {
                if !Self::is_attacked(b, 7, 4, false)
                    && !Self::is_attacked(b, 7, 5, false)
                    && !Self::is_attacked(b, 7, 6, false)
                {
                    list.push(Move {
                        from_row: 7,
                        from_col: 4,
                        to_row: 7,
                        to_col: 6,
                        piece: 'K',
                        captured: '.',
                        special: SpecialMove::CastleKingside,
                        promotion: '.',
                    });
                }
            }
            if state.can_castle_wq && b[7][0] == 'R' && b[7][1] == '.' && b[7][2] == '.' && b[7][3] == '.'
            {
                if !Self::is_attacked(b, 7, 4, false)
                    && !Self::is_attacked(b, 7, 3, false)
                    && !Self::is_attacked(b, 7, 2, false)
                {
                    list.push(Move {
                        from_row: 7,
                        from_col: 4,
                        to_row: 7,
                        to_col: 2,
                        piece: 'K',
                        captured: '.',
                        special: SpecialMove::CastleQueenside,
                        promotion: '.',
                    });
                }
            }
        } else {
            if r != 0 || c != 4 {
                return;
            }
            if state.can_castle_bk && b[0][7] == 'r' && b[0][5] == '.' && b[0][6] == '.' {
                if !Self::is_attacked(b, 0, 4, true)
                    && !Self::is_attacked(b, 0, 5, true)
                    && !Self::is_attacked(b, 0, 6, true)
                {
                    list.push(Move {
                        from_row: 0,
                        from_col: 4,
                        to_row: 0,
                        to_col: 6,
                        piece: 'k',
                        captured: '.',
                        special: SpecialMove::CastleKingside,
                        promotion: '.',
                    });
                }
            }
            if state.can_castle_bq && b[0][0] == 'r' && b[0][1] == '.' && b[0][2] == '.' && b[0][3] == '.'
            {
                if !Self::is_attacked(b, 0, 4, true)
                    && !Self::is_attacked(b, 0, 3, true)
                    && !Self::is_attacked(b, 0, 2, true)
                {
                    list.push(Move {
                        from_row: 0,
                        from_col: 4,
                        to_row: 0,
                        to_col: 2,
                        piece: 'k',
                        captured: '.',
                        special: SpecialMove::CastleQueenside,
                        promotion: '.',
                    });
                }
            }
        }
    }

    // ===== 伪合法走法生成入口 =====
    pub fn generate_pseudo_moves(state: &GameState, r: i32, c: i32) -> Vec<Move> {
        let mut list = Vec::new();
        let b = &state.board;
        let p = b[r as usize][c as usize];
        if p == '.' {
            return list;
        }
        let is_white = p.is_ascii_uppercase();
        let enemy_pawn = if is_white { 'p' } else { 'P' };
        match p.to_ascii_uppercase() {
            'P' => Self::gen_pawn_moves(&mut list, state, r, c, is_white, enemy_pawn),
            'N' => {
                let dr = [-2, -2, -1, -1, 1, 1, 2, 2];
                let dc = [-1, 1, -2, 2, -2, 2, -1, 1];
                Self::gen_offset_moves(&mut list, b, r, c, is_white, &dr, &dc);
            }
            'K' => {
                let dr = [-1, -1, -1, 0, 0, 1, 1, 1];
                let dc = [-1, 0, 1, -1, 1, -1, 0, 1];
                Self::gen_offset_moves(&mut list, b, r, c, is_white, &dr, &dc);
                Self::gen_castling_moves(&mut list, state, r, c, is_white);
            }
            'B' => {
                let dr = [-1, -1, 1, 1];
                let dc = [-1, 1, -1, 1];
                Self::gen_sliding_moves(&mut list, b, r, c, is_white, &dr, &dc);
            }
            'R' => {
                let dr = [-1, 1, 0, 0];
                let dc = [0, 0, -1, 1];
                Self::gen_sliding_moves(&mut list, b, r, c, is_white, &dr, &dc);
            }
            'Q' => {
                let dr = [-1, 1, 0, 0, -1, -1, 1, 1];
                let dc = [0, 0, -1, 1, -1, 1, -1, 1];
                Self::gen_sliding_moves(&mut list, b, r, c, is_white, &dr, &dc);
            }
            _ => {}
        }
        list
    }

    // ===== 合法走法（两阶段） =====
    pub fn generate_legal_moves(state: &GameState, r: i32, c: i32) -> Vec<Move> {
        let mut legal = Vec::new();
        let pseudo = Self::generate_pseudo_moves(state, r, c);
        if pseudo.is_empty() {
            return legal;
        }
        let mover_is_white = pseudo[0].piece.is_ascii_uppercase();
        for m in &pseudo {
            let mut sim = state.clone_light();
            Self::apply_move(&mut sim, m, false);
            let (kr, kc) = Self::find_king(&sim.board, mover_is_white);
            if !Self::is_attacked(&sim.board, kr, kc, !mover_is_white) {
                legal.push(m.clone());
            }
        }
        legal
    }

    pub fn generate_all_legal_moves(state: &GameState) -> Vec<Move> {
        let mut all = Vec::new();
        for r in 0..8 {
            for c in 0..8 {
                if Self::is_piece_of_side(state.board[r][c], state.white_to_move) {
                    for m in Self::generate_legal_moves(state, r as i32, c as i32) {
                        all.push(m);
                    }
                }
            }
        }
        all
    }

    // ===== 走子执行 =====
    pub fn apply_move(state: &mut GameState, m: &Move, record_history: bool) {
        let special = m.special;
        let piece = m.piece;
        // 1. 移动棋子本体
        state.board[m.to_row as usize][m.to_col as usize] = piece;
        state.board[m.from_row as usize][m.from_col as usize] = '.';

        // 2. 特殊走法处理
        match special {
            SpecialMove::DoublePawn => {
                state.en_passant_row = (m.from_row + m.to_row) / 2;
                state.en_passant_col = m.from_col;
            }
            SpecialMove::EnPassant => {
                let cap_row = if piece == 'P' {
                    m.to_row + 1
                } else {
                    m.to_row - 1
                };
                state.board[cap_row as usize][m.to_col as usize] = '.';
            }
            SpecialMove::CastleKingside => {
                state.board[m.from_row as usize][5] = state.board[m.from_row as usize][7];
                state.board[m.from_row as usize][7] = '.';
            }
            SpecialMove::CastleQueenside => {
                state.board[m.from_row as usize][3] = state.board[m.from_row as usize][0];
                state.board[m.from_row as usize][0] = '.';
            }
            SpecialMove::Promotion => {
                state.board[m.to_row as usize][m.to_col as usize] = m.promotion;
            }
            SpecialMove::None => {}
        }

        // 3. 非双进兵时清除过路兵目标格
        if special != SpecialMove::DoublePawn {
            state.en_passant_row = -1;
            state.en_passant_col = -1;
        }

        // 4. 更新易位权
        if piece == 'K' {
            state.can_castle_wk = false;
            state.can_castle_wq = false;
        } else if piece == 'k' {
            state.can_castle_bk = false;
            state.can_castle_bq = false;
        }
        if (m.from_row == 7 && m.from_col == 0) || (m.to_row == 7 && m.to_col == 0) {
            state.can_castle_wq = false;
        }
        if (m.from_row == 7 && m.from_col == 7) || (m.to_row == 7 && m.to_col == 7) {
            state.can_castle_wk = false;
        }
        if (m.from_row == 0 && m.from_col == 0) || (m.to_row == 0 && m.to_col == 0) {
            state.can_castle_bq = false;
        }
        if (m.from_row == 0 && m.from_col == 7) || (m.to_row == 0 && m.to_col == 7) {
            state.can_castle_bk = false;
        }

        // 5. 50 步规则计数
        if piece.to_ascii_uppercase() == 'P' || m.captured != '.' {
            state.halfmove_clock = 0;
        } else {
            state.halfmove_clock += 1;
        }

        // 6. 回合切换与记谱
        if !state.white_to_move {
            state.fullmove_number += 1;
        }
        state.white_to_move = !state.white_to_move;
        if record_history {
            state.history.push(m.to_string());
            state.position_keys.push(state.get_position_key());
        }
    }

    // ===== 王定位与将军检测 =====
    pub fn find_king(board: &[[char; 8]; 8], is_white: bool) -> (i32, i32) {
        let k = if is_white { 'K' } else { 'k' };
        for i in 0..8 {
            for j in 0..8 {
                if board[i][j] == k {
                    return (i as i32, j as i32);
                }
            }
        }
        (-1, -1)
    }

    pub fn is_in_check(state: &GameState, is_white: bool) -> bool {
        let (kr, kc) = Self::find_king(&state.board, is_white);
        if kr < 0 {
            return false;
        }
        Self::is_attacked(&state.board, kr, kc, !is_white)
    }

    // ===== 终局判定 =====
    pub fn is_checkmate(state: &GameState) -> bool {
        Self::is_in_check(state, state.white_to_move) && Self::generate_all_legal_moves(state).is_empty()
    }
    pub fn is_stalemate(state: &GameState) -> bool {
        !Self::is_in_check(state, state.white_to_move) && Self::generate_all_legal_moves(state).is_empty()
    }
    pub fn is_fifty_move_draw(state: &GameState) -> bool {
        state.halfmove_clock >= 100
    }

    pub fn has_legal_en_passant(state: &GameState) -> bool {
        if state.en_passant_row < 0 {
            return false;
        }
        let pawn_rank = if state.white_to_move {
            state.en_passant_row + 1
        } else {
            state.en_passant_row - 1
        };
        if pawn_rank < 0 || pawn_rank > 7 {
            return false;
        }
        let pawn = if state.white_to_move { 'P' } else { 'p' };
        for dc in [-1, 1] {
            let cc = state.en_passant_col + dc;
            if cc < 0 || cc > 7 {
                continue;
            }
            if state.board[pawn_rank as usize][cc as usize] == pawn {
                for m in Self::generate_legal_moves(state, pawn_rank, cc) {
                    if m.special == SpecialMove::EnPassant {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn is_threefold_repetition(state: &GameState) -> bool {
        if state.position_keys.is_empty() {
            return false;
        }
        let cur = state.position_keys.last().unwrap();
        let count = state.position_keys.iter().filter(|k| *k == cur).count();
        count >= 3
    }

    // 子力不足和棋（与 C++ 逐字对齐）
    pub fn is_insufficient_material(state: &GameState) -> bool {
        let mut white: Vec<(char, i32)> = Vec::new();
        let mut black: Vec<(char, i32)> = Vec::new();
        for r in 0..8 {
            for c in 0..8 {
                let p = state.board[r][c];
                if p == '.' || p.to_ascii_uppercase() == 'K' {
                    continue;
                }
                let up = p.to_ascii_uppercase();
                if up == 'P' || up == 'R' || up == 'Q' {
                    return false;
                }
                if p.is_ascii_uppercase() {
                    white.push((p, (r * 8 + c) as i32));
                } else {
                    black.push((p, (r * 8 + c) as i32));
                }
            }
        }
        let total = (white.len() + black.len()) as i32;
        if total == 0 {
            return true;
        }
        if total == 1 {
            return true;
        }
        if total == 2 {
            if white.len() == 1 && black.len() == 1 {
                return true;
            }
            let side = if white.len() == 2 { &white } else { &black };
            let a = side[0].0.to_ascii_uppercase();
            let b = side[1].0.to_ascii_uppercase();
            if a == 'B' && b == 'B' {
                let color0 = (side[0].1 / 8 + side[0].1 % 8) % 2;
                let color1 = (side[1].1 / 8 + side[1].1 % 8) % 2;
                return color0 == color1;
            }
            if a == 'N' && b == 'N' {
                return true;
            }
            return false;
        }
        false
    }
}
