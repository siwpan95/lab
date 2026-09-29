// =============================================================================
// chessCore.ts — 国际象棋核心引擎（TypeScript，对齐 C++ chess_core.*）
// -----------------------------------------------------------------------------
// 架构（与 C++ 版一致）：
//   1. 数据层：GameState（棋盘 + 行棋方 + 易位权 + 过路兵目标格 + 计数器）
//   2. 规则层：Rules（伪合法走法生成 → 在副本上模拟走子 → IsAttacked 过滤）
//   3. 终局层：将军 / 将死 / 逼和 / 50 步规则 / 子力不足 / 三次重复
//
// 棋盘表示（mailbox 方案，8x8 二维字符数组）：
//   board[row][col]
//     row 0 = 第 8 横线（黑方底线，屏幕上方）
//     row 7 = 第 1 横线（白方底线，屏幕下方）
//   大写 = 白方棋子  K Q R B N P
//   小写 = 黑方棋子  k q r b n p
//   '.'   = 空格
// =============================================================================

// ---------------------------- 特殊走法类型 ----------------------------
export const SpecialMove = {
    None: 0,
    DoublePawn: 1,   // 兵双重进兵（设置过路兵目标格）
    EnPassant: 2,    // 吃过路兵
    CastleKingside: 3,  // 短易位（王翼易位）
    CastleQueenside: 4, // 长易位（后翼易位）
    Promotion: 5     // 兵升变
} as const;
export type SpecialMove = typeof SpecialMove[keyof typeof SpecialMove];

// ---------------------------- 走法结构 ----------------------------
export class Move {
    fromRow = 0;
    fromCol = 0;
    toRow = 0;
    toCol = 0;
    piece = '.';     // 走动的棋子
    captured = '.';  // 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
    special: SpecialMove = SpecialMove.None;
    promotion = '.'; // 升变目标棋子（升变时有效）

    constructor(init?: Partial<Move>) {
        if (init) Object.assign(this, init);
    }

    isCapture(): boolean { return this.captured !== '.'; }

    // 长式代数记谱（无歧义），与 C++ Move::toString 完全一致
    toString(): string {
        if (this.special === SpecialMove.CastleKingside) return "O-O";
        if (this.special === SpecialMove.CastleQueenside) return "O-O-O";
        const files = "abcdefgh";
        const fromSq = files[this.fromCol] + (8 - this.fromRow);
        const toSq = files[this.toCol] + (8 - this.toRow);
        if (this.piece === 'P' || this.piece === 'p') {
            let s = "";
            if (this.isCapture()) s += files[this.fromCol]; // 兵吃子记来源文件
            s += toSq;
            if (this.special === SpecialMove.Promotion) {
                s += '=';
                s += this.promotion.toUpperCase();
            }
            return s;
        } else {
            let s = "";
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
    board: string[][] = [];
    whiteToMove = true;
    // 易位权（跟踪王/车是否动过、角上车是否被吃）
    canCastleWK = true;
    canCastleWQ = true;
    canCastleBK = true;
    canCastleBQ = true;
    // 过路兵目标格（上一步双进兵跳过的格），-1 表示无
    enPassantRow = -1;
    enPassantCol = -1;
    // 50 步规则半步计数（吃子或动兵清零）
    halfmoveClock = 0;
    fullmoveNumber = 1;
    // 记谱历史（长式代数记谱）
    history: string[] = [];
    // 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
    positionKeys: string[] = [];
    // runner 传入的本局已见局面键（engine.mjs 兼容键）及出现次数，供重复惩罚使用。
    // null ⇒ 不施加惩罚。搜索过程中只读取、从不修改，故 Clone/CloneLight 中保持共享引用。
    repHistory: { [key: string]: number } | null = null;

    constructor() {
        this.ResetToStartPosition();
    }

    ResetToStartPosition(): void {
        this.board = Array.from({ length: 8 }, () => Array<string>(8).fill('.'));
        const back = "rnbqkbnr";
        for (let c = 0; c < 8; ++c) {
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
    GetPositionKey(): string {
        let s = "";
        for (let r = 0; r < 8; ++r)
            for (let c = 0; c < 8; ++c)
                s += this.board[r][c];
        s += (this.whiteToMove ? 'w' : 'b');
        s += (this.canCastleWK ? 'K' : '-');
        s += (this.canCastleWQ ? 'Q' : '-');
        s += (this.canCastleBK ? 'k' : '-');
        s += (this.canCastleBQ ? 'q' : '-');
        if (Rules.HasLegalEnPassant(this)) {
            s += this.enPassantRow + ',' + this.enPassantCol;
        } else {
            s += "-1,-1";
        }
        return s;
    }

    // engine.mjs 兼容局面键（无 '-' 分隔的易位权、用存储值过路兵），供 runner 传来的
    // 重复惩罚比对使用。必须与 engine.mjs 的 getPositionKey 完全一致，否则惩罚永不触发。
    //   1. 64 格棋盘字符（row-major，TS 自身棋子字母，'.' 表示空）
    //   2. 行棋方：'w' 或 'b'
    //   3. 易位权：仅拼接存在的权利 'K''Q''k''q'，缺失不加 '-'、不加分隔符
    //   4. 过路兵：使用 FEN 解析后的存储值（enPassantRow/Col）；有则 ${row},${col}，无则 "-1,-1"
    PositionKeySimple(): string {
        let s = "";
        for (let r = 0; r < 8; ++r)
            for (let c = 0; c < 8; ++c)
                s += this.board[r][c];
        s += (this.whiteToMove ? 'w' : 'b');
        if (this.canCastleWK) s += 'K';
        if (this.canCastleWQ) s += 'Q';
        if (this.canCastleBK) s += 'k';
        if (this.canCastleBQ) s += 'q';
        if (this.enPassantRow >= 0 && this.enPassantCol >= 0) {
            s += this.enPassantRow + ',' + this.enPassantCol;
        } else {
            s += "-1,-1";
        }
        return s;
    }

    // 深拷贝（含记谱与局面键）
    Clone(): GameState {
        const s = new GameState();
        s.board = this.board.map(row => row.slice());
        s.whiteToMove = this.whiteToMove;
        s.canCastleWK = this.canCastleWK; s.canCastleWQ = this.canCastleWQ;
        s.canCastleBK = this.canCastleBK; s.canCastleBQ = this.canCastleBQ;
        s.enPassantRow = this.enPassantRow; s.enPassantCol = this.enPassantCol;
        s.halfmoveClock = this.halfmoveClock; s.fullmoveNumber = this.fullmoveNumber;
        s.history = this.history.slice();
        s.positionKeys = this.positionKeys.slice();
        s.repHistory = this.repHistory; // 共享只读引用（搜索不修改）
        return s;
    }

    // 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝，降低每节点开销）
    CloneLight(): GameState {
        const s = new GameState();
        s.board = this.board.map(row => row.slice());
        s.whiteToMove = this.whiteToMove;
        s.canCastleWK = this.canCastleWK; s.canCastleWQ = this.canCastleWQ;
        s.canCastleBK = this.canCastleBK; s.canCastleBQ = this.canCastleBQ;
        s.enPassantRow = this.enPassantRow; s.enPassantCol = this.enPassantCol;
        s.halfmoveClock = this.halfmoveClock; s.fullmoveNumber = this.fullmoveNumber;
        s.history = [];
        s.positionKeys = [];
        s.repHistory = this.repHistory; // 共享只读引用（搜索不修改）
        return s;
    }
}

// ---------------------------- 规则引擎 ----------------------------
export class Rules {
    // ===== 基础工具 =====
    static InBoard(r: number, c: number): boolean { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
    static IsWhitePiece(p: string): boolean { return p !== '.' && p >= 'A' && p <= 'Z'; }
    static IsBlackPiece(p: string): boolean { return p !== '.' && p >= 'a' && p <= 'z'; }
    static IsPieceOfSide(p: string, white: boolean): boolean {
        if (p === '.') return false;
        return white ? Rules.IsWhitePiece(p) : Rules.IsBlackPiece(p);
    }

    // ===== IsAttacked：单一例程支撑整个规则库 =====
    static IsAttacked(board: string[][], r: number, c: number, byWhite: boolean): boolean {
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
        for (let i = 0; i < 8; ++i) {
            const tr = r + dr2[i], tc = c + dc2[i];
            if (Rules.InBoard(tr, tc) && board[tr][tc] === knight) return true;
        }

        // --- 3. 王攻击（8 邻格） ---
        const king = byWhite ? 'K' : 'k';
        for (let dr = -1; dr <= 1; ++dr)
            for (let dc = -1; dc <= 1; ++dc) {
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
        for (let i = 0; i < 8; ++i) {
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

    // ===== 伪合法走法生成（仅几何规则，未过滤送王） =====
    static GeneratePseudoMoves(state: GameState, r: number, c: number): Move[] {
        const list: Move[] = [];
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

    // ===== 合法走法（两阶段：模拟走子过滤送王着法） =====
    static GenerateLegalMoves(state: GameState, r: number, c: number): Move[] {
        const legal: Move[] = [];
        const pseudo = Rules.GeneratePseudoMoves(state, r, c);
        if (pseudo.length === 0) return legal;

        const moverIsWhite = Rules.IsWhitePiece(pseudo[0].piece);
        for (const m of pseudo) {
            const sim = state.CloneLight();
            Rules.ApplyMove(sim, m, false);
            const [kr, kc] = Rules.FindKing(sim.board, moverIsWhite);
            if (!Rules.IsAttacked(sim.board, kr, kc, !moverIsWhite))
                legal.push(m);
        }
        return legal;
    }

    static GenerateAllLegalMoves(state: GameState): Move[] {
        const all: Move[] = [];
        for (let r = 0; r < 8; ++r)
            for (let c = 0; c < 8; ++c)
                if (Rules.IsPieceOfSide(state.board[r][c], state.whiteToMove))
                    for (const m of Rules.GenerateLegalMoves(state, r, c))
                        all.push(m);
        return all;
    }

    // ===== 走子执行（增量更新状态） =====
    // recordHistory=false 供 AI 搜索路径使用（跳过记谱与局面键，降低开销）
    static ApplyMove(state: GameState, m: Move, recordHistory = true): void {
        const b = state.board;

        // 1. 移动棋子本体
        b[m.toRow][m.toCol] = m.piece;
        b[m.fromRow][m.fromCol] = '.';

        // 2. 特殊走法处理
        switch (m.special) {
            case SpecialMove.DoublePawn:
                state.enPassantRow = (m.fromRow + m.toRow) / 2;
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
    static FindKing(board: string[][], isWhite: boolean): [number, number] {
        const k = isWhite ? 'K' : 'k';
        for (let i = 0; i < 8; ++i)
            for (let j = 0; j < 8; ++j)
                if (board[i][j] === k) return [i, j];
        return [-1, -1];
    }

    static IsInCheck(state: GameState, isWhite: boolean): boolean {
        const [kr, kc] = Rules.FindKing(state.board, isWhite);
        if (kr < 0) return false;
        return Rules.IsAttacked(state.board, kr, kc, !isWhite);
    }

    // ===== 终局判定 =====
    static IsCheckmate(state: GameState): boolean {
        return Rules.IsInCheck(state, state.whiteToMove) && Rules.GenerateAllLegalMoves(state).length === 0;
    }
    static IsStalemate(state: GameState): boolean {
        return !Rules.IsInCheck(state, state.whiteToMove) && Rules.GenerateAllLegalMoves(state).length === 0;
    }
    static IsFiftyMoveDraw(state: GameState): boolean {
        return state.halfmoveClock >= 100;
    }

    // 是否存在合法的吃过路兵着法（供三次重复局面键决定是否编码 ep 格）
    static HasLegalEnPassant(state: GameState): boolean {
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

    static IsThreefoldRepetition(state: GameState): boolean {
        if (state.positionKeys.length === 0) return false;
        const cur = state.positionKeys[state.positionKeys.length - 1];
        let count = 0;
        for (const k of state.positionKeys)
            if (k === cur) ++count;
        return count >= 3;
    }

    // 子力不足和棋（扩展版：KK / K+单象 / K+单马 / KNN / 异色格象组合等真实和棋）
    static IsInsufficientMaterial(state: GameState): boolean {
        type Piece = { piece: string; pos: number };
        const white: Piece[] = [];
        const black: Piece[] = [];
        for (let r = 0; r < 8; ++r)
            for (let c = 0; c < 8; ++c) {
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

    // ===== 私有走法生成辅助 =====
    private static GeneratePawnMoves(list: Move[], state: GameState, r: number, c: number, isWhite: boolean, enemyPawn: string): void {
        const b = state.board;
        const dir = isWhite ? -1 : 1;
        const startRow = isWhite ? 6 : 1;

        // 前进一格（目标格须为空）
        if (Rules.InBoard(r + dir, c) && b[r + dir][c] === '.') {
            Rules.AddPawnMove(list, r, c, r + dir, c, '.', SpecialMove.None, isWhite);
            // 起始位置双重进兵
            if (r === startRow && b[r + 2 * dir][c] === '.') {
                list.push(new Move({
                    fromRow: r, fromCol: c, toRow: r + 2 * dir, toCol: c,
                    piece: b[r][c], captured: '.', special: SpecialMove.DoublePawn, promotion: '.'
                }));
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

    private static AddPawnMove(list: Move[], fr: number, fc: number, tr: number, tc: number, captured: string, special: SpecialMove, isWhite: boolean): void {
        if (tr === 0 || tr === 7) {
            const promos = "QRBN";
            for (let i = 0; i < 4; ++i) {
                list.push(new Move({
                    fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                    piece: isWhite ? 'P' : 'p',
                    captured: captured,
                    special: SpecialMove.Promotion,
                    promotion: isWhite ? promos[i] : promos[i].toLowerCase()
                }));
            }
        } else {
            list.push(new Move({
                fromRow: fr, fromCol: fc, toRow: tr, toCol: tc,
                piece: isWhite ? 'P' : 'p',
                captured: captured,
                special: special,
                promotion: '.'
            }));
        }
    }

    private static GenerateOffsetMoves(list: Move[], board: string[][], r: number, c: number, isWhite: boolean, dr: number[], dc: number[], n: number): void {
        const p = board[r][c];
        for (let i = 0; i < n; ++i) {
            const tr = r + dr[i], tc = c + dc[i];
            if (!Rules.InBoard(tr, tc)) continue;
            const target = board[tr][tc];
            if (target === '.' || Rules.IsPieceOfSide(target, !isWhite)) {
                list.push(new Move({
                    fromRow: r, fromCol: c, toRow: tr, toCol: tc,
                    piece: p, captured: target, special: SpecialMove.None, promotion: '.'
                }));
            }
        }
    }

    private static GenerateSlidingMoves(list: Move[], board: string[][], r: number, c: number, isWhite: boolean, dr: number[], dc: number[], n: number): void {
        const p = board[r][c];
        for (let i = 0; i < n; ++i) {
            let tr = r + dr[i], tc = c + dc[i];
            while (Rules.InBoard(tr, tc)) {
                const target = board[tr][tc];
                if (target === '.') {
                    list.push(new Move({
                        fromRow: r, fromCol: c, toRow: tr, toCol: tc,
                        piece: p, captured: '.', special: SpecialMove.None, promotion: '.'
                    }));
                } else {
                    if (Rules.IsPieceOfSide(target, !isWhite)) {
                        list.push(new Move({
                            fromRow: r, fromCol: c, toRow: tr, toCol: tc,
                            piece: p, captured: target, special: SpecialMove.None, promotion: '.'
                        }));
                    }
                    break;
                }
                tr += dr[i]; tc += dc[i];
            }
        }
    }

    private static GenerateCastlingMoves(list: Move[], state: GameState, r: number, c: number, isWhite: boolean): void {
        const b = state.board;
        if (isWhite) {
            if (r !== 7 || c !== 4) return;
            // 白方短易位：K e1→g1，R h1→f1
            if (state.canCastleWK && b[7][7] === 'R' && b[7][5] === '.' && b[7][6] === '.') {
                if (!Rules.IsAttacked(b, 7, 4, false) && !Rules.IsAttacked(b, 7, 5, false) && !Rules.IsAttacked(b, 7, 6, false)) {
                    list.push(new Move({ fromRow: 7, fromCol: 4, toRow: 7, toCol: 6, piece: 'K', captured: '.', special: SpecialMove.CastleKingside, promotion: '.' }));
                }
            }
            // 白方长易位：K e1→c1，R a1→d1
            if (state.canCastleWQ && b[7][0] === 'R' && b[7][1] === '.' && b[7][2] === '.' && b[7][3] === '.') {
                if (!Rules.IsAttacked(b, 7, 4, false) && !Rules.IsAttacked(b, 7, 3, false) && !Rules.IsAttacked(b, 7, 2, false)) {
                    list.push(new Move({ fromRow: 7, fromCol: 4, toRow: 7, toCol: 2, piece: 'K', captured: '.', special: SpecialMove.CastleQueenside, promotion: '.' }));
                }
            }
        } else {
            if (r !== 0 || c !== 4) return;
            // 黑方短易位：K e8→g8，R h8→f8
            if (state.canCastleBK && b[0][7] === 'r' && b[0][5] === '.' && b[0][6] === '.') {
                if (!Rules.IsAttacked(b, 0, 4, true) && !Rules.IsAttacked(b, 0, 5, true) && !Rules.IsAttacked(b, 0, 6, true)) {
                    list.push(new Move({ fromRow: 0, fromCol: 4, toRow: 0, toCol: 6, piece: 'k', captured: '.', special: SpecialMove.CastleKingside, promotion: '.' }));
                }
            }
            // 黑方长易位：K e8→c8，R a8→d8
            if (state.canCastleBQ && b[0][0] === 'r' && b[0][1] === '.' && b[0][2] === '.' && b[0][3] === '.') {
                if (!Rules.IsAttacked(b, 0, 4, true) && !Rules.IsAttacked(b, 0, 3, true) && !Rules.IsAttacked(b, 0, 2, true)) {
                    list.push(new Move({ fromRow: 0, fromCol: 4, toRow: 0, toCol: 2, piece: 'k', captured: '.', special: SpecialMove.CastleQueenside, promotion: '.' }));
                }
            }
        }
    }
}
