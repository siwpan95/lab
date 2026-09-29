// =============================================================================
// ChessAI.java — AI 对弈引擎（Java 17，对齐 CppChess 参考实现）
// -----------------------------------------------------------------------------
// 架构：评估层（子力价值 + PST）+ 搜索层（negamax + alpha-beta + MVV-LVA 走法排序
//        + 静态搜索 quiescence）+ 终局评分（将死 ±900000）。
// 零第三方依赖，仅用 JDK 标准库。PieceValue 与 6 张 PST 表逐字对齐 chess_ai.cpp。
// =============================================================================

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

class AIEngine {

    static final int MateScore = 900000;   // 将死基准分
    static final int Infinity = 1000000;    // 有界无穷大
    // 重复惩罚：叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过）中时，按出现次数
    // 扣分（白方视角）。引导搜索远离重复局面，减少三重复和棋。约半兵，足以影响平手选择而不弃子。
    static final int REPETITION_PENALTY = 60;

    // ---------------------------- 子力价值（厘兵单位） ----------------------------
    // 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
    static final int[] PieceValue = {0, 100, 320, 330, 500, 900, 0};

    // ---------------------------- 位置价值表 PST（白方视角） ----------------------------
    static final int[] PST_Pawn = {
        0,  0,  0,  0,  0,  0,  0,  0,
       50, 50, 50, 50, 50, 50, 50, 50,
       10, 10, 20, 30, 30, 20, 10, 10,
        5,  5, 10, 25, 25, 10,  5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5, -5,-10,  0,  0,-10, -5,  5,
        5, 10, 10,-20,-20, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0
    };
    static final int[] PST_Knight = {
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    };
    static final int[] PST_Bishop = {
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    };
    static final int[] PST_Rook = {
        0,  0,  0,  0,  0,  0,  0,  0,
        5, 10, 10, 10, 10, 10, 10,  5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
        0,  0,  0,  5,  5,  0,  0,  0
    };
    static final int[] PST_Queen = {
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    };
    static final int[] PST_King = {
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    };

    // ---------------------------- 内部工具 ----------------------------
    static int PieceIndex(char p) {
        switch (Character.toUpperCase(p)) {
            case 'P': return 1;
            case 'N': return 2;
            case 'B': return 3;
            case 'R': return 4;
            case 'Q': return 5;
            case 'K': return 6;
            default:  return 0;
        }
    }

    static int GetPST(int pieceIdx, int pos) {
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

    // ---------------------------- 局面评估（白方视角） ----------------------------
    static int Evaluate(GameState state) {
        int score = 0;
        char[][] b = state.board;
        for (int r = 0; r < 8; ++r) {
            for (int c = 0; c < 8; ++c) {
                char p = b[r][c];
                if (p == '.') continue;
                int idx = PieceIndex(p);
                int pos = r * 8 + c;
                if (Character.isUpperCase(p)) {
                    score += PieceValue[idx] + GetPST(idx, pos);
                } else {
                    score -= PieceValue[idx] + GetPST(idx, (7 - r) * 8 + c);
                }
            }
        }
        // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if (state.RepHistory != null) {
            Integer cnt = state.RepHistory.get(state.PositionKeySimple());
            if (cnt != null && cnt > 0) {
                score -= REPETITION_PENALTY * cnt;
            }
        }
        return score;
    }

    // 当前行棋方视角分数（negamax 约定）
    static int EvaluateSide(GameState state) {
        int s = Evaluate(state);
        return state.whiteToMove ? s : -s;
    }

    // ---------------------------- 走法排序（MVV-LVA） ----------------------------
    static int MoveOrderScore(Move m) {
        if (m.captured == '.') return 0;
        int victim = PieceValue[PieceIndex(m.captured)];
        int attacker = PieceValue[PieceIndex(m.piece)];
        return victim * 10 - attacker;
    }

    static void OrderMoves(List<Move> moves) {
        Collections.sort(moves, new Comparator<Move>() {
            public int compare(Move a, Move b) {
                return Integer.compare(MoveOrderScore(b), MoveOrderScore(a)); // 降序
            }
        });
    }

    // ---------------------------- 静态搜索（quiescence） ----------------------------
    static int Quiescence(GameState state, int alpha, int beta, int qdepth) {
        int stand = EvaluateSide(state);
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (qdepth >= 4) return alpha;

        List<Move> captures = new ArrayList<>();
        for (Move m : Rules.GenerateAllLegalMoves(state))
            if (m.captured != '.') captures.add(m);
        OrderMoves(captures);

        for (Move m : captures) {
            GameState child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            int score = -Quiescence(child, -beta, -alpha, qdepth + 1);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    // ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
    static int Negamax(GameState state, int depth, int alpha, int beta, int ply) {
        List<Move> moves = Rules.GenerateAllLegalMoves(state);

        if (moves.isEmpty()) {
            if (Rules.IsInCheck(state, state.whiteToMove))
                return -MateScore + ply; // 被将死：离根越近越差
            return 0; // 逼和
        }

        if (depth <= 0)
            return Quiescence(state, alpha, beta, 0);

        OrderMoves(moves);

        int best = -Infinity;
        for (Move m : moves) {
            GameState child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            int score = -Negamax(child, depth - 1, -beta, -alpha, ply + 1);
            if (score > best) best = score;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break; // β 剪枝
        }
        return best;
    }

    // ---------------------------- 对外接口：求最佳走法 ----------------------------
    // 无合法走法时返回 null（对齐 C++ 的 std::nullopt）
    static Move FindBestMove(GameState state, int depth) {
        List<Move> moves = Rules.GenerateAllLegalMoves(state);
        if (moves.isEmpty()) return null;
        if (moves.size() == 1) return moves.get(0);

        OrderMoves(moves);

        Move bestMove = moves.get(0);
        int bestScore = -Infinity;
        int alpha = -Infinity;
        int beta = Infinity;

        for (Move m : moves) {
            GameState child = state.CloneLight();
            Rules.ApplyMove(child, m, false);
            int score = -Negamax(child, depth - 1, -beta, -alpha, 1);
            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
            }
            if (score > alpha) alpha = score;
        }
        return bestMove;
    }
}
