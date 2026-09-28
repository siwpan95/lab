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

export class AIEngine {
    static readonly MateScore = 900000;   // 将死基准分
    static readonly Infinity = 1000000;   // 有界无穷大

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
