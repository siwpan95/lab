// =============================================================================
// chessAI.js — AI 对弈引擎（JavaScript ES Module）
// -----------------------------------------------------------------------------
// 与 CppChess\chess_ai.h/.cpp 完全对等的移植。
//
//   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
//   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
//   3. 终局评分：将死 ±900000（越快将死分越高）、逼和/子力不足 = 0
//
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// 性能：搜索路径使用 GameState.CloneLight() + ApplyMove(recordHistory=false)
// =============================================================================

import { GameState, Rules, Move, SpecialMove } from './chessCore.js';

// ---------------------------- 子力价值（厘兵单位） ----------------------------
// 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
const PieceValue = [0, 100, 320, 330, 500, 900, 0];

// 重复惩罚：叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过）中时，按出现次数
// 扣分（白方视角）。引导搜索远离重复局面，减少三重复和棋。约半兵，足以影响平手选择而不弃子。
const REPETITION_PENALTY = 60;

// ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
// 每引擎一份独立 profile，定义新增评估术语的权重。所有术语都是白黑严格镜像差值，
// 因此初始局面（完全对称）评估仍为 0 —— tests.js「初始局面评估 = 0（对称）」保持成立。
// mobilityWeight 为预留字段（0 = 关闭），试点只启用兵盾/兵形/双象三组术语。
// 权重表规范源在 tournament/validate_eval_profile.mjs，本档必须与其逐字段一致。
const EVAL_PROFILE = {
    name: 'aggressive',
    pawnShieldMissing: 30,   // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
    pawnShieldOpenFile: 20,  // 王自家线在王前方已无任何己方兵
    doubledPawn: 8,          // 每个叠兵（同线多出的每一个）
    isolatedPawn: 10,        // 每个孤兵（相邻线无己方兵）
    passedPawnBase: 15,      // 通路兵基础分
    passedPawnPerRank: 6,    // 通路兵每向升变推进一行的加成
    bishopPair: 20,          // 双象
    mobilityWeight: 0        // 预留：机动性每步权重（试点关闭）
};

// profile 规范化串 + djb2-32 哈希。验收门（validate_eval_profile.mjs）用同一算法
// 独立重算并比对，防止「声明 A 档、实装别的数字」的漂移。字段顺序与分隔符即契约。
function evalProfileHash(p) {
    const s = `${p.name}|${p.pawnShieldMissing}|${p.pawnShieldOpenFile}|${p.doubledPawn}` +
              `|${p.isolatedPawn}|${p.passedPawnBase}|${p.passedPawnPerRank}` +
              `|${p.bishopPair}|${p.mobilityWeight}`;
    let h = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
}

// ---------------------------- 位置价值表 PST（白方视角） ----------------------------
const PST_Pawn = [
    0,  0,  0,  0,  0,  0,  0,  0,
   50, 50, 50, 50, 50, 50, 50, 50,
   10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
];
const PST_Knight = [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
];
const PST_Bishop = [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
];
const PST_Rook = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
];
const PST_Queen = [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
];
const PST_King = [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20
];

// ---------------------------- 内部工具 ----------------------------
function PieceIndex(p) {
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

function GetPST(pieceIdx, pos) {
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

// ---------------------------- Tier 2-B 时间控制 ----------------------------
// 迭代加深 + 软/硬双阈值：
//   · 软阈值：开新一轮深度前检查（已用时间 >= 预算×SOFT_FRACTION 就不再开新轮），
//     避免"明知做不完还开局"；
//   · 硬阈值：搜索过程中按节点数周期检查（每 NODES_PER_TIME_CHECK 个节点），
//     超限立即中断；被中断的那一轮**结果作废**，只采用上一轮完整深度的结果。
// 这样保证返回的着法始终来自一次完整搜索，绝不会因为中断返回半成品。
// timeMs <= 0（或缺省请求）时完全不启用，走原来的固定深度搜索路径。
const NODES_PER_TIME_CHECK = 2048;
const SOFT_FRACTION = 0.5;

class SearchClock {
    constructor(limitMs) {
        this.limit = limitMs;
        this.start = Date.now();
        this.softMs = this.start + limitMs * SOFT_FRACTION;
        this.nodes = 0;
        this.aborted = false;
    }
    // 软阈值：是否不该再开新一轮深度
    overSoft() { return Date.now() >= this.softMs; }
    // 硬阈值：每 NODES_PER_TIME_CHECK 个节点查一次；超限置 aborted
    tick() {
        this.nodes++;
        if ((this.nodes & (NODES_PER_TIME_CHECK - 1)) === 0) {
            if (Date.now() - this.start >= this.limit) this.aborted = true;
        }
        return this.aborted;
    }
}

// 当前搜索的时钟（无时间控制时为 null）
let searchClock = null;

export class AIEngine {
    static get MateScore() { return 900000; }
    static get Infinity() { return 1000000; }

    // 局面评估（白方视角：正 = 白方占优）
    static Evaluate(state) {
        let score = 0;
        const b = state.board;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = b[r][c];
                if (p === '.') continue;
                const idx = PieceIndex(p);
                const pos = r * 8 + c;
                if (Rules.IsWhitePiece(p)) {
                    score += PieceValue[idx] + GetPST(idx, pos);
                } else {
                    score -= PieceValue[idx] + GetPST(idx, (7 - r) * 8 + c);
                }
            }
        }
        // Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
        // 保持「初始局面评估 = 0」的对称性不变量。
        score += AIEngine.PawnStructureScore(state);
        score += AIEngine.KingSafetyScore(state);
        score += AIEngine.BishopPairScore(state);
        // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if (state.RepHistory) {
            const key = state.PositionKeySimple();
            const cnt = state.RepHistory[key];
            if (cnt) score -= REPETITION_PENALTY * cnt;
        }
        return score;
    }

    static get ProfileName() { return EVAL_PROFILE.name; }
    static get ProfileHash() { return evalProfileHash(EVAL_PROFILE); }

    // 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
    static PawnStructureScore(state) {
        const b = state.board;
        const wCnt = [0, 0, 0, 0, 0, 0, 0, 0];
        const bCnt = [0, 0, 0, 0, 0, 0, 0, 0];
        const wPawns = [];
        const bPawns = [];
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
    static KingSafetyScore(state) {
        const b = state.board;
        let wk = null, bk = null;
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
    static BishopPairScore(state) {
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

    // 当前行棋方视角分数（negamax 约定）
    static EvaluateSide(state) {
        const s = AIEngine.Evaluate(state);
        return state.whiteToMove ? s : -s;
    }

    // 走法排序（MVV-LVA）
    static MoveOrderScore(m) {
        if (m.captured === '.') return 0;
        const victim = PieceValue[PieceIndex(m.captured)];
        const attacker = PieceValue[PieceIndex(m.piece)];
        return victim * 10 - attacker;
    }

    static OrderMoves(moves) {
        moves.sort((a, b) => AIEngine.MoveOrderScore(b) - AIEngine.MoveOrderScore(a));
    }

    // 静态搜索（quiescence）
    static Quiescence(state, alpha, beta, qdepth) {
        // Tier 2-B：同 Negamax，途中按节点数检查硬阈值。
        if (searchClock && searchClock.tick()) return alpha;
        const stand = AIEngine.EvaluateSide(state);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (qdepth >= 4) return alpha;

        const captures = [];
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

    // 主搜索：negamax + alpha-beta
    static Negamax(state, depth, alpha, beta, ply) {
        // Tier 2-B：硬阈值按节点数周期检查，超限立即中断（未完成的一轮会被丢弃）。
        if (searchClock && searchClock.tick()) return alpha;
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

    // 根结点一轮搜索（给定深度）。返回最佳走法。
    static SearchRoot(state, moves, depth) {
        AIEngine.OrderMoves(moves);
        let bestMove = moves[0];
        let bestScore = -AIEngine.Infinity;
        let alpha = -AIEngine.Infinity;
        const beta = AIEngine.Infinity;

        for (const m of moves) {
            const child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            const score = -AIEngine.Negamax(child, depth - 1, -beta, -alpha, 1);
            if (searchClock && searchClock.aborted) break; // 硬阈值中断：丢弃本轮
            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
            }
            if (score > alpha) alpha = score;
        }
        return bestMove;
    }

    // 对外接口：求最佳走法（无合法走法时为 null）
    // timeMs > 0 时启用 Tier 2-B 时间控制（迭代加深 + 软/硬双阈值）；
    // timeMs <= 0 / 缺省 时走原来的固定深度单次搜索，结果与改造前逐字节一致。
    static FindBestMove(state, depth, timeMs) {
        const moves = Rules.GenerateAllLegalMoves(state);
        if (moves.length === 0) return null;
        if (moves.length === 1) return moves[0];

        const budget = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
        const cap = depth > 0 ? depth : 3;

        if (budget <= 0 || cap <= 1) {
            // 原路径：固定深度单次搜索（不含任何时钟开销）
            const prev = searchClock;
            searchClock = null;
            const mv = AIEngine.SearchRoot(state, moves.slice(), cap);
            searchClock = prev;
            return mv;
        }

        // 迭代加深：d = 1..cap，软阈值管“是否开新一轮”，硬阈值管“中断当前轮”。
        searchClock = new SearchClock(budget);
        let bestMove = moves[0];
        let completed = false; // 是否已至少完成一轮（中断时回退到它）
        try {
            for (let d = 1; d <= cap; d++) {
                if (completed && searchClock.overSoft()) break;
                searchClock.aborted = false;
                const mv = AIEngine.SearchRoot(state, moves.slice(), d);
                if (searchClock.aborted && completed) break; // 丢弃未完成的这一轮
                bestMove = mv;
                completed = true;
            }
        } finally {
            searchClock = null;
        }
        return bestMove; // 至少完成过 depth=1 的一轮，必为合法着法
    }
}
