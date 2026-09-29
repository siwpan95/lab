// =============================================================================
// chessAI.ts — AI 对弈引擎（TypeScript，对齐 C++ chess_ai.*）
// -----------------------------------------------------------------------------
// 架构（参考轻量国际象棋引擎通用方案）：
//   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
//   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
//   3. 终局评分：将死 ±900000（越快将死分越高）、逼和/子力不足 = 0
//
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// 性能：搜索路径使用 GameState.CloneLight() + ApplyMove(recordHistory=false)
// =============================================================================

import { GameState, Move, Rules, SpecialMove } from './chessCore.ts';

// 重复惩罚：当某个叶局面的 engine.mjs 兼容键出现在 repHistory（本局此前见过的局面）
// 中时，按出现次数扣分（白方视角）。目的是引导搜索远离会把对局带回重复局面的走法，
// 从而减少三重复和棋。取值约半兵，足够影响平手选择、又不至于让引擎为了避重而弃子。
const REPETITION_PENALTY = 60;

// ---------------------------- 评估风格档（Tier 2-C 批2：TS） ----------------------------
// 每引擎一份独立 profile，定义新增评估术语的权重。所有术语都是白黑严格镜像差值，
// 因此初始局面（完全对称）评估仍为 0 —— tests.ts「初始局面评估 = 0（对称）」保持成立。
// mobilityWeight 为预留字段（0 = 关闭），只启用兵盾/兵形/双象三组术语。
// 权重表规范源在 tournament/validate_eval_profile.mjs，本档必须与其逐字段一致。
const EVAL_PROFILE = {
    name: 'hypermodern',
    pawnShieldMissing: 15,  // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
    pawnShieldOpenFile: 18, // 王自家线在王前方已无任何己方兵
    doubledPawn: 10,        // 每个叠兵（同线多出的每一个）
    isolatedPawn: 12,       // 每个孤兵（相邻线无己方兵）
    passedPawnBase: 22,     // 通路兵基础分
    passedPawnPerRank: 9,   // 通路兵每向升变推进一行的加成
    bishopPair: 45,         // 双象
    mobilityWeight: 0       // 预留：机动性每步权重（关闭）
};

// profile 规范化串 + djb2-32 哈希。验收门（validate_eval_profile.mjs）用同一算法
// 独立重算并比对，防止「声明 A 档、实装别的数字」的漂移。字段顺序与分隔符即契约。
function evalProfileHash(p: typeof EVAL_PROFILE): string {
    const s = `${p.name}|${p.pawnShieldMissing}|${p.pawnShieldOpenFile}|${p.doubledPawn}` +
              `|${p.isolatedPawn}|${p.passedPawnBase}|${p.passedPawnPerRank}` +
              `|${p.bishopPair}|${p.mobilityWeight}`;
    let h = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
}

export class AIEngine {
    static readonly MateScore = 900000;   // 将死基准分
    static readonly Infinity = 1000000;   // 有界无穷大

    static get ProfileName(): string { return EVAL_PROFILE.name; }
    static get ProfileHash(): string { return evalProfileHash(EVAL_PROFILE); }

    // 局面评估（白方视角：正 = 白方占优）
    static Evaluate(state: GameState): number {
        let score = 0;
        const b = state.board;
        for (let r = 0; r < 8; ++r) {
            for (let c = 0; c < 8; ++c) {
                const p = b[r][c];
                if (p === '.') continue;
                const idx = AIEngine.PieceIndex(p);
                const pos = r * 8 + c;
                if (Rules.IsWhitePiece(p)) {
                    score += PieceValue[idx] + AIEngine.GetPST(idx, pos);
                } else {
                    score -= PieceValue[idx] + AIEngine.GetPST(idx, (7 - r) * 8 + c);
                }
            }
        }
        // Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
        // 保持「初始局面评估 = 0」的对称性不变量。
        score += AIEngine.PawnStructureScore(state);
        score += AIEngine.KingSafetyScore(state);
        score += AIEngine.BishopPairScore(state);
        // 重复惩罚：叶局面在 repHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if (state.repHistory) {
            const key = state.PositionKeySimple();
            const cnt = state.repHistory[key];
            if (cnt) score -= REPETITION_PENALTY * cnt;
        }
        return score;
    }

    // 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
    static PawnStructureScore(state: GameState): number {
        const b = state.board;
        const wCnt = [0, 0, 0, 0, 0, 0, 0, 0];
        const bCnt = [0, 0, 0, 0, 0, 0, 0, 0];
        const wPawns: Array<[number, number]> = [];
        const bPawns: Array<[number, number]> = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (b[r][c] === 'P') { wCnt[c]++; wPawns.push([r, c]); }
                else if (b[r][c] === 'p') { bCnt[c]++; bPawns.push([r, c]); }
            }
        }
        const W = EVAL_PROFILE;
        let score = 0;
        for (let c = 0; c < 8; c++) {
            if (wCnt[c] > 1) score -= W.doubledPawn * (wCnt[c] - 1);
            if (bCnt[c] > 1) score += W.doubledPawn * (bCnt[c] - 1);
        }
        for (const [r, c] of wPawns) {
            const isolated = (c === 0 || wCnt[c - 1] === 0) && (c === 7 || wCnt[c + 1] === 0);
            if (isolated) score -= W.isolatedPawn;
            let passed = true;
            for (let f = c - 1; f <= c + 1 && passed; f++) {
                if (f < 0 || f > 7) continue;
                for (let rr = r - 1; rr >= 0; rr--)
                    if (b[rr][f] === 'p') { passed = false; break; }
            }
            if (passed) score += W.passedPawnBase + W.passedPawnPerRank * (6 - r);
        }
        for (const [r, c] of bPawns) {
            const isolated = (c === 0 || bCnt[c - 1] === 0) && (c === 7 || bCnt[c + 1] === 0);
            if (isolated) score += W.isolatedPawn;
            let passed = true;
            for (let f = c - 1; f <= c + 1 && passed; f++) {
                if (f < 0 || f > 7) continue;
                for (let rr = r + 1; rr <= 7; rr++)
                    if (b[rr][f] === 'P') { passed = false; break; }
            }
            if (passed) score -= W.passedPawnBase + W.passedPawnPerRank * (r - 1);
        }
        return score;
    }

    // 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
    static KingSafetyScore(state: GameState): number {
        const b = state.board;
        let wk: [number, number] | null = null, bk: [number, number] | null = null;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                if (b[r][c] === 'K') wk = [r, c];
                else if (b[r][c] === 'k') bk = [r, c];
            }
        if (!wk || !bk) return 0;
        const W = EVAL_PROFILE;
        let score = 0;
        if (wk[0] >= 6) {
            for (let c = Math.max(0, wk[1] - 1); c <= Math.min(7, wk[1] + 1); c++)
                if (b[wk[0] - 1][c] !== 'P') score -= W.pawnShieldMissing;
            let shielded = false;
            for (let r = wk[0] - 1; r >= 0; r--) if (b[r][wk[1]] === 'P') { shielded = true; break; }
            if (!shielded) score -= W.pawnShieldOpenFile;
        }
        if (bk[0] <= 1) {
            for (let c = Math.max(0, bk[1] - 1); c <= Math.min(7, bk[1] + 1); c++)
                if (b[bk[0] + 1][c] !== 'p') score += W.pawnShieldMissing;
            let shielded = false;
            for (let r = bk[0] + 1; r <= 7; r++) if (b[r][bk[1]] === 'p') { shielded = true; break; }
            if (!shielded) score += W.pawnShieldOpenFile;
        }
        return score;
    }

    // 双象分（白方视角差值）。
    static BishopPairScore(state: GameState): number {
        let wb = 0, bb = 0;
        const b = state.board;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                if (b[r][c] === 'B') wb++;
                else if (b[r][c] === 'b') bb++;
            }
        let score = 0;
        if (wb >= 2) score += EVAL_PROFILE.bishopPair;
        if (bb >= 2) score -= EVAL_PROFILE.bishopPair;
        return score;
    }

    // 主搜索：negamax + alpha-beta
    static Negamax(state: GameState, depth: number, alpha: number, beta: number, ply: number): number {
        const moves = Rules.GenerateAllLegalMoves(state);

        if (moves.length === 0) {
            if (Rules.IsInCheck(state, state.whiteToMove))
                return -AIEngine.MateScore + ply; // 被将死：离根越近越差
            return 0; // 逼和
        }

        if (depth <= 0)
            return AIEngine.Quiescence(state, alpha, beta, 0);

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

    // 对外接口：求最佳走法（无合法走法时为 null）
    static FindBestMove(state: GameState, depth: number): Move | null {
        const moves = Rules.GenerateAllLegalMoves(state);
        if (moves.length === 0) return null;
        if (moves.length === 1) return moves[0];

        AIEngine.OrderMoves(moves);

        let bestMove: Move = moves[0];
        let bestScore = -AIEngine.Infinity;
        let alpha = -AIEngine.Infinity;
        const beta = AIEngine.Infinity;

        for (const m of moves) {
            const child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            const score = -AIEngine.Negamax(child, depth - 1, -beta, -alpha, 1);
            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
            }
            if (score > alpha) alpha = score;
        }
        return bestMove;
    }

    // 静态搜索（quiescence）
    static Quiescence(state: GameState, alpha: number, beta: number, qdepth: number): number {
        const stand = AIEngine.EvaluateSide(state);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (qdepth >= 4) return alpha;

        const captures: Move[] = [];
        for (const m of Rules.GenerateAllLegalMoves(state))
            if (m.captured !== '.') captures.push(m);
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

    // ===== 内部工具 =====
    static PieceIndex(p: string): number {
        switch (p.toUpperCase()) {
            case 'P': return 1;
            case 'N': return 2;
            case 'B': return 3;
            case 'R': return 4;
            case 'Q': return 5;
            case 'K': return 6;
            default: return 0;
        }
    }

    static GetPST(pieceIdx: number, pos: number): number {
        switch (pieceIdx) {
            case 1: return PST_Pawn[pos];
            case 2: return PST_Knight[pos];
            case 3: return PST_Bishop[pos];
            case 4: return PST_Rook[pos];
            case 5: return PST_Queen[pos];
            case 6: return PST_King[pos];
            default: return 0;
        }
    }

    private static MoveOrderScore(m: Move): number {
        if (m.captured === '.') return 0;
        const victim = PieceValue[AIEngine.PieceIndex(m.captured)];
        const attacker = PieceValue[AIEngine.PieceIndex(m.piece)];
        return victim * 10 - attacker;
    }

    private static OrderMoves(moves: Move[]): void {
        moves.sort((a, b) => AIEngine.MoveOrderScore(b) - AIEngine.MoveOrderScore(a));
    }

    // 当前行棋方视角分数（negamax 约定）
    private static EvaluateSide(state: GameState): number {
        const s = AIEngine.Evaluate(state);
        return state.whiteToMove ? s : -s;
    }
}

// ---------------------------- 子力价值（厘兵单位） ----------------------------
// 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
const PieceValue: number[] = [0, 100, 320, 330, 500, 900, 0];

// ---------------------------- 位置价值表 PST（白方视角） ----------------------------
const PST_Pawn: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
];
const PST_Knight: number[] = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
];
const PST_Bishop: number[] = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
];
const PST_Rook: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0
];
const PST_Queen: number[] = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
];
const PST_King: number[] = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20
];
