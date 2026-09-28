// =============================================================================
// chessCore.js — 国际象棋核心引擎（JavaScript ES Module）
// -----------------------------------------------------------------------------
// 与 CppChess\chess_core.h/.cpp 完全对等的移植。
//
// 棋盘表示（mailbox，8x8 二维字符数组）：
//   board[row][col]
//     row 0 = 第 8 横线（黑方底线，屏幕上方）
//     row 7 = 第 1 横线（白方底线，屏幕下方）
//   大写 = 白方棋子  K Q R B N P
//   小写 = 黑方棋子  k q r b n p
//   '.'   = 空格
//
// 导出：GameState 类、Rules 类、Move 类、SpecialMove 枚举对象。
// =============================================================================

// ---------------------------- 特殊走法类型 ----------------------------
export const SpecialMove = {
    None: 0,
    DoublePawn: 1,    // 兵双重进兵（设置过路兵目标格）
    EnPassant: 2,     // 吃过路兵
    CastleKingside: 3,// 短易位（王翼易位）
    CastleQueenside: 4,// 长易位（后翼易位）
    Promotion: 5      // 兵升变
};

// ---------------------------- 走法结构 ----------------------------
export class Move {
    constructor(fromRow = 0, fromCol = 0, toRow = 0, toCol = 0,
                piece = '.', captured = '.', special = SpecialMove.None, promotion = '.') {
        this.fromRow = fromRow;
        this.fromCol = fromCol;
        this.toRow = toRow;
        this.toCol = toCol;
        this.piece = piece;     // 走动的棋子
        this.captured = captured; // 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
        this.special = special;
        this.promotion = promotion; // 升变目标棋子（升变时有效）
    }

    isCapture() { return this.captured !== '.'; }

    // 长式代数记谱（与 C++ Move::toString 完全一致）
    toString() {
        if (this.special === SpecialMove.CastleKingside) return 'O-O';
        if (this.special === SpecialMove.CastleQueenside) return 'O-O-O';
        const files = 'abcdefgh';
        const fromSq = files[this.fromCol] + (8 - this.fromRow);
        const toSq = files[this.toCol] + (8 - this.toRow);
        if (this.piece === 'P' || this.piece === 'p') {
            let s = '';
            if (this.isCapture()) s += files[this.fromCol]; // 兵吃子记来源文件
            s += toSq;
            if (this.special === SpecialMove.Promotion) {
                s += '=' + this.promotion.toUpperCase();
            }
            return s;
        } else {
            let s = '';
            s += this.piece.toUpperCase();
            s += fromSq;
            if (this.isCapture()) s += 'x';
            s += toSq;
            return s;
        }
    }
}

// ---------------------------- 对局状态 ----------------------------
export class GameState {
    constructor() {
        this.board = [];
        this.whiteToMove = true;
        this.canCastleWK = true;
        this.canCastleWQ = true;
        this.canCastleBK = true;
        this.canCastleBQ = true;
        this.enPassantRow = -1;
        this.enPassantCol = -1;
        this.halfmoveClock = 0;
        this.fullmoveNumber = 1;
        this.history = [];
        this.positionKeys = [];
        this.ResetToStartPosition();
    }

    ResetToStartPosition() {
        const back = 'rnbqkbnr';
        this.board = [];
        for (let r = 0; r < 8; r++) this.board.push(new Array(8).fill('.'));
        for (let c = 0; c < 8; c++) {
            this.board[0][c] = back[c];
            this.board[1][c] = 'p';
            this.board[2][c] = '.';
            this.board[3][c] = '.';
            this.board[4][c] = '.';
            this.board[5][c] = '.';
            this.board[6][c] = 'P';
            this.board[7][c] = back[c].toUpperCase();
        }
        this.whiteToMove = true;
        this.canCastleWK = this.canCastleWQ = this.canCastleBK = this.canCastleBQ = true;
        this.enPassantRow = this.enPassantCol = -1;
        this.halfmoveClock = 0;
        this.fullmoveNumber = 1;
        this.history = [];
        this.positionKeys = [];
        this.positionKeys.push(this.GetPositionKey());
    }

    // 局面键：影响重复判定的全部状态
    GetPositionKey() {
        let s = '';
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                s += this.board[r][c];
        s += (this.whiteToMove ? 'w' : 'b');
        s += (this.canCastleWK ? 'K' : '-');
        s += (this.canCastleWQ ? 'Q' : '-');
        s += (this.canCastleBK ? 'k' : '-');
        s += (this.canCastleBQ ? 'q' : '-');
        if (Rules.HasLegalEnPassant(this)) {
            s += this.enPassantRow + ',' + this.enPassantCol;
        } else {
            s += '-1,-1';
        }
        return s;
    }

    // 深拷贝（含记谱与局面键）
    Clone() {
        const s = new GameState();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                s.board[r][c] = this.board[r][c];
        s.whiteToMove = this.whiteToMove;
        s.canCastleWK = this.canCastleWK; s.canCastleWQ = this.canCastleWQ;
        s.canCastleBK = this.canCastleBK; s.canCastleBQ = this.canCastleBQ;
        s.enPassantRow = this.enPassantRow; s.enPassantCol = this.enPassantCol;
        s.halfmoveClock = this.halfmoveClock; s.fullmoveNumber = this.fullmoveNumber;
        s.history = this.history.slice();
        s.positionKeys = this.positionKeys.slice();
        return s;
    }

    // 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝）
    CloneLight() {
        const s = new GameState();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                s.board[r][c] = this.board[r][c];
        s.whiteToMove = this.whiteToMove;
        s.canCastleWK = this.canCastleWK; s.canCastleWQ = this.canCastleWQ;
        s.canCastleBK = this.canCastleBK; s.canCastleBQ = this.canCastleBQ;
        s.enPassantRow = this.enPassantRow; s.enPassantCol = this.enPassantCol;
        s.halfmoveClock = this.halfmoveClock; s.fullmoveNumber = this.fullmoveNumber;
        return s;
    }
}

// ---------------------------- 规则引擎 ----------------------------
export class Rules {
    // ===== 基础工具 =====
    static InBoard(r, c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
    static IsWhitePiece(p) { return p !== '.' && p === p.toUpperCase() && p !== p.toLowerCase(); }
    static IsBlackPiece(p) { return p !== '.' && p === p.toLowerCase() && p !== p.toUpperCase(); }
    static IsPieceOfSide(p, white) {
        if (p === '.') return false;
        const upper = (p === p.toUpperCase() && p !== p.toLowerCase());
        return white ? upper : !upper;
    }

    // ===== IsAttacked：单一例程支撑整个规则库 =====
    static IsAttacked(board, r, c, byWhite) {
        // --- 1. 兵攻击（白兵攻击其上方两斜格，黑兵反之） ---
        const pawn = byWhite ? 'P' : 'p';
        const pr = byWhite ? r + 1 : r - 1;
        if (pr >= 0 && pr <= 7) {
            if (c - 1 >= 0 && board[pr][c - 1] === pawn) return true;
            if (c + 1 <= 7 && board[pr][c + 1] === pawn) return true;
        }

        // --- 2. 马攻击（8 个 L 形跳位） ---
        const knight = byWhite ? 'N' : 'n';
        const dr2 = [-2, -2, -1, -1, 1, 1, 2, 2];
        const dc2 = [-1, 1, -2, 2, -2, 2, -1, 1];
        for (let i = 0; i < 8; i++) {
            const tr = r + dr2[i], tc = c + dc2[i];
            if (Rules.InBoard(tr, tc) && board[tr][tc] === knight) return true;
        }

        // --- 3. 王攻击（8 邻格） ---
        const king = byWhite ? 'K' : 'k';
        for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const tr = r + dr, tc = c + dc;
                if (Rules.InBoard(tr, tc) && board[tr][tc] === king) return true;
            }

        // --- 4. 滑动射线攻击：直线（车/后）+ 斜线（象/后） ---
        const rook = byWhite ? 'R' : 'r';
        const queen = byWhite ? 'Q' : 'q';
        const bishop = byWhite ? 'B' : 'b';
        const dirR = [-1, 1, 0, 0, -1, -1, 1, 1];
        const dirC = [0, 0, -1, 1, -1, 1, -1, 1];
        for (let i = 0; i < 8; i++) {
            let tr = r + dirR[i], tc = c + dirC[i];
            while (Rules.InBoard(tr, tc)) {
                const p = board[tr][tc];
                if (p !== '.') {
                    if (i < 4) { if (p === rook || p === queen) return true; }
                    else { if (p === bishop || p === queen) return true; }
                    break;
                }
                tr += dirR[i]; tc += dirC[i];
            }
        }
        return false;
    }

    // ===== 兵走法 =====
    static GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn) {
        const b = state.board;
        const dir = isWhite ? -1 : 1;
        const startRow = isWhite ? 6 : 1;

        // 前进一格（目标格须为空）
        if (Rules.InBoard(r + dir, c) && b[r + dir][c] === '.') {
            Rules.AddPawnMove(list, r, c, r + dir, c, '.', SpecialMove.None, isWhite);
            // 起始位置双重进兵
            if (r === startRow && b[r + 2 * dir][c] === '.') {
                list.push(new Move(r, c, r + 2 * dir, c, b[r][c], '.', SpecialMove.DoublePawn, '.'));
            }
        }

        // 斜吃 / 吃过路兵
        const dcs = [-1, 1];
        for (const dc of dcs) {
            const tr = r + dir, tc = c + dc;
            if (!Rules.InBoard(tr, tc)) continue;
            const target = b[tr][tc];
            if (target !== '.' && Rules.IsPieceOfSide(target, !isWhite)) {
                Rules.AddPawnMove(list, r, c, tr, tc, target, SpecialMove.None, isWhite);
            } else if (tr === state.enPassantRow && tc === state.enPassantCol) {
                Rules.AddPawnMove(list, r, c, tr, tc, enemyPawn, SpecialMove.EnPassant, isWhite);
            }
        }
    }

    static AddPawnMove(list, fr, fc, tr, tc, captured, special, isWhite) {
        if (tr === 0 || tr === 7) {
            const promos = 'QRBN';
            for (let i = 0; i < 4; i++) {
                list.push(new Move(fr, fc, tr, tc, isWhite ? 'P' : 'p',
                    captured, SpecialMove.Promotion,
                    isWhite ? promos[i] : promos[i].toLowerCase()));
            }
        } else {
            list.push(new Move(fr, fc, tr, tc, isWhite ? 'P' : 'p',
                captured, special, '.'));
        }
    }

    // ===== 马/王固定偏移 =====
    static GenerateOffsetMoves(list, board, r, c, isWhite, dr, dc, n) {
        const p = board[r][c];
        for (let i = 0; i < n; i++) {
            const tr = r + dr[i], tc = c + dc[i];
            if (!Rules.InBoard(tr, tc)) continue;
            const target = board[tr][tc];
            if (target === '.' || Rules.IsPieceOfSide(target, !isWhite)) {
                list.push(new Move(r, c, tr, tc, p, target, SpecialMove.None, '.'));
            }
        }
    }

    // ===== 象/车/后滑动 =====
    static GenerateSlidingMoves(list, board, r, c, isWhite, dr, dc, n) {
        const p = board[r][c];
        for (let i = 0; i < n; i++) {
            let tr = r + dr[i], tc = c + dc[i];
            while (Rules.InBoard(tr, tc)) {
                const target = board[tr][tc];
                if (target === '.') {
                    list.push(new Move(r, c, tr, tc, p, '.', SpecialMove.None, '.'));
                } else {
                    if (Rules.IsPieceOfSide(target, !isWhite)) {
                        list.push(new Move(r, c, tr, tc, p, target, SpecialMove.None, '.'));
                    }
                    break;
                }
                tr += dr[i]; tc += dc[i];
            }
        }
    }

    // ===== 王车易位 =====
    static GenerateCastlingMoves(list, state, r, c, isWhite) {
        const b = state.board;
        if (isWhite) {
            if (r !== 7 || c !== 4) return;
            // 白方短易位：K e1→g1，R h1→f1
            if (state.canCastleWK && b[7][7] === 'R' && b[7][5] === '.' && b[7][6] === '.') {
                if (!Rules.IsAttacked(b, 7, 4, false) && !Rules.IsAttacked(b, 7, 5, false) && !Rules.IsAttacked(b, 7, 6, false)) {
                    list.push(new Move(7, 4, 7, 6, 'K', '.', SpecialMove.CastleKingside, '.'));
                }
            }
            // 白方长易位：K e1→c1，R a1→d1
            if (state.canCastleWQ && b[7][0] === 'R' && b[7][1] === '.' && b[7][2] === '.' && b[7][3] === '.') {
                if (!Rules.IsAttacked(b, 7, 4, false) && !Rules.IsAttacked(b, 7, 3, false) && !Rules.IsAttacked(b, 7, 2, false)) {
                    list.push(new Move(7, 4, 7, 2, 'K', '.', SpecialMove.CastleQueenside, '.'));
                }
            }
        } else {
            if (r !== 0 || c !== 4) return;
            // 黑方短易位：K e8→g8，R h8→f8
            if (state.canCastleBK && b[0][7] === 'r' && b[0][5] === '.' && b[0][6] === '.') {
                if (!Rules.IsAttacked(b, 0, 4, true) && !Rules.IsAttacked(b, 0, 5, true) && !Rules.IsAttacked(b, 0, 6, true)) {
                    list.push(new Move(0, 4, 0, 6, 'k', '.', SpecialMove.CastleKingside, '.'));
                }
            }
            // 黑方长易位：K e8→c8，R a8→d8
            if (state.canCastleBQ && b[0][0] === 'r' && b[0][1] === '.' && b[0][2] === '.' && b[0][3] === '.') {
                if (!Rules.IsAttacked(b, 0, 4, true) && !Rules.IsAttacked(b, 0, 3, true) && !Rules.IsAttacked(b, 0, 2, true)) {
                    list.push(new Move(0, 4, 0, 2, 'k', '.', SpecialMove.CastleQueenside, '.'));
                }
            }
        }
    }

    // ===== 伪合法走法生成入口 =====
    static GeneratePseudoMoves(state, r, c) {
        const list = [];
        const b = state.board;
        const p = b[r][c];
        if (p === '.') return list;

        const isWhite = Rules.IsWhitePiece(p);
        const enemyPawn = isWhite ? 'p' : 'P';

        switch (p.toUpperCase()) {
            case 'P': Rules.GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn); break;
            case 'N': {
                const dr = [-2, -2, -1, -1, 1, 1, 2, 2];
                const dc = [-1, 1, -2, 2, -2, 2, -1, 1];
                Rules.GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
            } break;
            case 'K': {
                const dr = [-1, -1, -1, 0, 0, 1, 1, 1];
                const dc = [-1, 0, 1, -1, 1, -1, 0, 1];
                Rules.GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
                Rules.GenerateCastlingMoves(list, state, r, c, isWhite);
            } break;
            case 'B': {
                const dr = [-1, -1, 1, 1];
                const dc = [-1, 1, -1, 1];
                Rules.GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
            } break;
            case 'R': {
                const dr = [-1, 1, 0, 0];
                const dc = [0, 0, -1, 1];
                Rules.GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
            } break;
            case 'Q': {
                const dr = [-1, 1, 0, 0, -1, -1, 1, 1];
                const dc = [0, 0, -1, 1, -1, 1, -1, 1];
                Rules.GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 8);
            } break;
        }
        return list;
    }

    // ===== 合法走法（两阶段） =====
    static GenerateLegalMoves(state, r, c) {
        const legal = [];
        const pseudo = Rules.GeneratePseudoMoves(state, r, c);
        if (pseudo.length === 0) return legal;

        const moverIsWhite = Rules.IsWhitePiece(pseudo[0].piece);
        for (const m of pseudo) {
            const sim = state.CloneLight();
            Rules.ApplyMove(sim, m, false);
            const k = Rules.FindKing(sim.board, moverIsWhite);
            const kr = k.r, kc = k.c;
            if (!Rules.IsAttacked(sim.board, kr, kc, !moverIsWhite))
                legal.push(m);
        }
        return legal;
    }

    static GenerateAllLegalMoves(state) {
        const all = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (Rules.IsPieceOfSide(state.board[r][c], state.whiteToMove))
                    for (const m of Rules.GenerateLegalMoves(state, r, c))
                        all.push(m);
        return all;
    }

    // ===== 走子执行 =====
    static ApplyMove(state, m, recordHistory = true) {
        const b = state.board;

        // 1. 移动棋子本体
        b[m.toRow][m.toCol] = m.piece;
        b[m.fromRow][m.fromCol] = '.';

        // 2. 特殊走法处理
        switch (m.special) {
            case SpecialMove.DoublePawn:
                state.enPassantRow = Math.floor((m.fromRow + m.toRow) / 2);
                state.enPassantCol = m.fromCol;
                break;
            case SpecialMove.EnPassant: {
                const capRow = (m.piece === 'P') ? m.toRow + 1 : m.toRow - 1;
                b[capRow][m.toCol] = '.';
            } break;
            case SpecialMove.CastleKingside:
                b[m.fromRow][5] = b[m.fromRow][7];
                b[m.fromRow][7] = '.';
                break;
            case SpecialMove.CastleQueenside:
                b[m.fromRow][3] = b[m.fromRow][0];
                b[m.fromRow][0] = '.';
                break;
            case SpecialMove.Promotion:
                b[m.toRow][m.toCol] = m.promotion;
                break;
            default: break;
        }

        // 3. 非双进兵时清除过路兵目标格
        if (m.special !== SpecialMove.DoublePawn) {
            state.enPassantRow = -1;
            state.enPassantCol = -1;
        }

        // 4. 更新易位权
        if (m.piece === 'K') { state.canCastleWK = false; state.canCastleWQ = false; }
        else if (m.piece === 'k') { state.canCastleBK = false; state.canCastleBQ = false; }
        if ((m.fromRow === 7 && m.fromCol === 0) || (m.toRow === 7 && m.toCol === 0)) state.canCastleWQ = false;
        if ((m.fromRow === 7 && m.fromCol === 7) || (m.toRow === 7 && m.toCol === 7)) state.canCastleWK = false;
        if ((m.fromRow === 0 && m.fromCol === 0) || (m.toRow === 0 && m.toCol === 0)) state.canCastleBQ = false;
        if ((m.fromRow === 0 && m.fromCol === 7) || (m.toRow === 0 && m.toCol === 7)) state.canCastleBK = false;

        // 5. 50 步规则计数
        if (m.piece.toUpperCase() === 'P' || m.captured !== '.')
            state.halfmoveClock = 0;
        else
            state.halfmoveClock += 1;

        // 6. 回合切换与记谱
        if (!state.whiteToMove) state.fullmoveNumber += 1;
        state.whiteToMove = !state.whiteToMove;
        if (recordHistory) {
            state.history.push(m.toString());
            state.positionKeys.push(state.GetPositionKey());
        }
    }

    // ===== 王定位与将军检测 =====
    static FindKing(board, isWhite) {
        const k = isWhite ? 'K' : 'k';
        for (let i = 0; i < 8; i++)
            for (let j = 0; j < 8; j++)
                if (board[i][j] === k) return { r: i, c: j };
        return { r: -1, c: -1 };
    }

    static IsInCheck(state, isWhite) {
        const k = Rules.FindKing(state.board, isWhite);
        if (k.r < 0) return false;
        return Rules.IsAttacked(state.board, k.r, k.c, !isWhite);
    }

    // ===== 终局判定 =====
    static IsCheckmate(state) {
        return Rules.IsInCheck(state, state.whiteToMove) && Rules.GenerateAllLegalMoves(state).length === 0;
    }
    static IsStalemate(state) {
        return !Rules.IsInCheck(state, state.whiteToMove) && Rules.GenerateAllLegalMoves(state).length === 0;
    }
    static IsFiftyMoveDraw(state) {
        return state.halfmoveClock >= 100;
    }

    static HasLegalEnPassant(state) {
        if (state.enPassantRow < 0) return false;
        const pawnRank = state.whiteToMove ? state.enPassantRow + 1 : state.enPassantRow - 1;
        if (pawnRank < 0 || pawnRank > 7) return false;
        const pawn = state.whiteToMove ? 'P' : 'p';
        for (let dc = -1; dc <= 1; dc += 2) {
            const c = state.enPassantCol + dc;
            if (c < 0 || c > 7) continue;
            if (state.board[pawnRank][c] === pawn) {
                for (const m of Rules.GenerateLegalMoves(state, pawnRank, c))
                    if (m.special === SpecialMove.EnPassant) return true;
            }
        }
        return false;
    }

    static IsThreefoldRepetition(state) {
        if (state.positionKeys.length === 0) return false;
        const cur = state.positionKeys[state.positionKeys.length - 1];
        let count = 0;
        for (const k of state.positionKeys)
            if (k === cur) count++;
        return count >= 3;
    }

    static IsInsufficientMaterial(state) {
        const white = []; // {piece, pos}
        const black = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = state.board[r][c];
                if (p === '.' || p.toUpperCase() === 'K') continue;
                const up = p.toUpperCase();
                if (up === 'P' || up === 'R' || up === 'Q') return false;
                if (Rules.IsWhitePiece(p)) white.push({ piece: p, pos: r * 8 + c });
                else black.push({ piece: p, pos: r * 8 + c });
            }
        const total = white.length + black.length;
        if (total === 0) return true;          // K vs K
        if (total === 1) return true;          // K + 单象 / 单马 vs K
        if (total === 2) {
            if (white.length === 1 && black.length === 1) return true; // 各执一子
            const side = (white.length === 2) ? white : black;
            const a = side[0].piece.toUpperCase();
            const b = side[1].piece.toUpperCase();
            if (a === 'B' && b === 'B') {
                const color0 = (Math.floor(side[0].pos / 8) + (side[0].pos % 8)) % 2;
                const color1 = (Math.floor(side[1].pos / 8) + (side[1].pos % 8)) % 2;
                return color0 === color1; // 同色格双象=和棋，异色格可杀
            }
            if (a === 'N' && b === 'N') return true; // 双马 vs K（和棋）
            return false;
        }
        return false;
    }
}

// =============================================================================
// AIEngine — 与 PyChess/chess_ai.py 及 vendor/tschess.mjs 完全对等的移植。
// 评估：子力价值(PieceValue) + 棋子-位置价值表(PST)；
// 搜索：negamax + alpha-beta 剪枝 + MVV-LVA 走法排序 + quiescence 静态搜索；
// 终局：将死 ±MateScore（越快将死分越高）、逼和/子力不足 = 0。
// 统一使用与另外两版完全相同的数值表，保证跨引擎评估一致、共识可比对。
// =============================================================================

// 子力价值（厘兵单位）：索引 0=空 1=兵 2=马 3=象 4=车 5=后 6=王
export const PieceValue = [0, 100, 320, 330, 500, 900, 0];

const PST_Pawn = [
    0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_Knight = [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_Bishop = [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_Rook = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_Queen = [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_King = [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
];
// PST[idx]：按 PieceIndex 索引（索引 0 为占位全 0）
const PST = [
    new Array(64).fill(0), // 0 空
    PST_Pawn, PST_Knight, PST_Bishop, PST_Rook, PST_Queen, PST_King,
];

export class AIEngine {
    static MateScore = 900000;
    static Infinity = 1000000;

    // ---- 内部工具 ----
    static PieceIndex(p) {
        const up = (p === p.toUpperCase() && p !== p.toLowerCase()) ? p : p;
        const u = up.toUpperCase();
        if (u === 'P') return 1;
        if (u === 'N') return 2;
        if (u === 'B') return 3;
        if (u === 'R') return 4;
        if (u === 'Q') return 5;
        if (u === 'K') return 6;
        return 0;
    }
    static GetPST(idx, pos) {
        if (idx >= 0 && idx <= 6) return PST[idx][pos];
        return 0;
    }

    // ---- 局面评估（白方视角）----
    static Evaluate(state) {
        let score = 0;
        const b = state.board;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = b[r][c];
                if (p === '.') continue;
                const idx = AIEngine.PieceIndex(p);
                const pos = r * 8 + c;
                if (Rules.IsWhitePiece(p)) score += PieceValue[idx] + AIEngine.GetPST(idx, pos);
                else score -= PieceValue[idx] + AIEngine.GetPST(idx, (7 - r) * 8 + c);
            }
        }
        return score;
    }
    static EvaluateSide(state) {
        const s = AIEngine.Evaluate(state);
        return state.whiteToMove ? s : -s;
    }

    // ---- 走法排序（MVV-LVA）----
    static MoveOrderScore(m) {
        if (m.captured === '.') return 0;
        const victim = PieceValue[AIEngine.PieceIndex(m.captured)];
        const attacker = PieceValue[AIEngine.PieceIndex(m.piece)];
        return victim * 10 - attacker;
    }
    static OrderMoves(moves) {
        moves.sort((a, b) => AIEngine.MoveOrderScore(b) - AIEngine.MoveOrderScore(a));
    }

    // ---- 静态搜索（quiescence）----
    static Quiescence(state, alpha, beta, qdepth) {
        const stand = AIEngine.EvaluateSide(state);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (qdepth >= 4) return alpha;

        const captures = [];
        for (const m of Rules.GenerateAllLegalMoves(state)) {
            if (m.captured !== '.') captures.push(m);
        }
        AIEngine.OrderMoves(captures);
        for (const m of captures) {
            const child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            const score = -AIEngine.Quiescence(child, -beta, -alpha, qdepth + 1);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    // ---- 主搜索：negamax + alpha-beta ----
    static Negamax(state, depth, alpha, beta, ply) {
        const moves = Rules.GenerateAllLegalMoves(state);
        if (moves.length === 0) {
            if (Rules.IsInCheck(state, state.whiteToMove)) return -AIEngine.MateScore + ply; // 被将死
            return 0; // 逼和
        }
        if (depth <= 0) return AIEngine.Quiescence(state, alpha, beta, 0);

        AIEngine.OrderMoves(moves);
        let best = -AIEngine.Infinity;
        for (const m of moves) {
            const child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            const score = -AIEngine.Negamax(child, depth - 1, -beta, -alpha, ply + 1);
            if (score > best) best = score;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break; // β 剪枝
        }
        return best;
    }

    // ---- 对外接口：求最佳走法 ----
    static FindBestMove(state, depth) {
        const moves = Rules.GenerateAllLegalMoves(state);
        if (moves.length === 0) return null;
        if (moves.length === 1) return moves[0];

        AIEngine.OrderMoves(moves);
        let bestMove = moves[0];
        let bestScore = -AIEngine.Infinity;
        let alpha = -AIEngine.Infinity;
        const beta = AIEngine.Infinity;

        for (const m of moves) {
            const child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            const score = -AIEngine.Negamax(child, depth - 1, -beta, -alpha, 1);
            if (score > bestScore) { bestScore = score; bestMove = m; }
            if (score > alpha) alpha = score;
        }
        return bestMove;
    }
}
