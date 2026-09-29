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

    // ---------------------------- 评估风格档（Tier 2-C 批2：java=solid） ----------------------------
    // 与 JsChess/chessAI.js 的 EVAL_PROFILE / Go 版 EvalProfileSpec 同构：每引擎一份独立
    // profile，定义新增评估术语的权重。所有术语都是白黑严格镜像差值，因此初始局面
    // （完全对称）评估仍为 0 —— Tests 的「初始局面评估 = 0」断言保持成立。
    // mobilityWeight 为预留字段（0 = 关闭），只启用兵盾/兵形/双象三组术语。
    // 权重表规范源在 tournament/validate_eval_profile.mjs（ASSIGNMENT: java=solid），
    // 本档必须与其逐字段一致。
    // 字段顺序即规范化串顺序，ProfileHash 的输出即契约。
    static final String PROFILE_NAME = "solid";
    static final int PAWN_SHIELD_MISSING = 25;   // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
    static final int PAWN_SHIELD_OPEN_FILE = 15; // 王自家线在王前方已无任何己方兵
    static final int DOUBLED_PAWN = 15;          // 每个叠兵（同线多出的每一个）
    static final int ISOLATED_PAWN = 18;         // 每个孤兵（相邻线无己方兵）
    static final int PASSED_PAWN_BASE = 18;      // 通路兵基础分
    static final int PASSED_PAWN_PER_RANK = 7;   // 通路兵每向升变推进一行的加成
    static final int BISHOP_PAIR = 25;           // 双象
    static final int MOBILITY_WEIGHT = 0;        // 预留：机动性每步权重（试点关闭）

    // ProfileHash：profile 规范化串的 djb2-32，与 JS/Go 侧逐字节同算法。
    // 规范化串 "solid|25|15|15|18|18|7|25|0"（整数无空格），期望 a9f5abd3。
    static String ProfileHash() {
        String s = PROFILE_NAME + "|" + PAWN_SHIELD_MISSING + "|" + PAWN_SHIELD_OPEN_FILE
                + "|" + DOUBLED_PAWN + "|" + ISOLATED_PAWN + "|" + PASSED_PAWN_BASE
                + "|" + PASSED_PAWN_PER_RANK + "|" + BISHOP_PAIR + "|" + MOBILITY_WEIGHT;
        long h = 5381L;
        for (int i = 0; i < s.length(); ++i) {
            h = (h * 33 + (long) (s.charAt(i) & 0xFF)) & 0xFFFFFFFFL;
        }
        return String.format("%08x", h);
    }

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
        // Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
        // 保持「初始局面评估 = 0」的对称性不变量。
        score += PawnStructureScore(state);
        score += KingSafetyScore(state);
        score += BishopPairScore(state);
        // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if (state.RepHistory != null) {
            Integer cnt = state.RepHistory.get(state.PositionKeySimple());
            if (cnt != null && cnt > 0) {
                score -= REPETITION_PENALTY * cnt;
            }
        }
        return score;
    }

    // ---------------------------- Tier 2-C 风格术语（白黑镜像差值） ----------------------------

    // 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
    // 通路兵判定：同 file 与相邻 file 在自己前方（白 r-1..0 / 黑 r+1..7）无任何敌方兵。
    static int PawnStructureScore(GameState state) {
        char[][] b = state.board;
        int[] wCnt = new int[8];
        int[] bCnt = new int[8];
        List<int[]> wPawns = new ArrayList<>();
        List<int[]> bPawns = new ArrayList<>();
        for (int r = 0; r < 8; ++r) {
            for (int c = 0; c < 8; ++c) {
                if (b[r][c] == 'P') { ++wCnt[c]; wPawns.add(new int[]{r, c}); }
                else if (b[r][c] == 'p') { ++bCnt[c]; bPawns.add(new int[]{r, c}); }
            }
        }
        int score = 0;
        for (int c = 0; c < 8; ++c) {
            if (wCnt[c] > 1) score -= DOUBLED_PAWN * (wCnt[c] - 1);
            if (bCnt[c] > 1) score += DOUBLED_PAWN * (bCnt[c] - 1);
        }
        for (int[] pc : wPawns) {
            int r = pc[0], c = pc[1];
            boolean isolated = (c == 0 || wCnt[c - 1] == 0) && (c == 7 || wCnt[c + 1] == 0);
            if (isolated) score -= ISOLATED_PAWN;
            boolean passed = true;
            for (int f = c - 1; f <= c + 1 && passed; ++f) {
                if (f < 0 || f > 7) continue;
                for (int rr = r - 1; rr >= 0; --rr)
                    if (b[rr][f] == 'p') { passed = false; break; }
            }
            if (passed) score += PASSED_PAWN_BASE + PASSED_PAWN_PER_RANK * (6 - r);
        }
        for (int[] pc : bPawns) {
            int r = pc[0], c = pc[1];
            boolean isolated = (c == 0 || bCnt[c - 1] == 0) && (c == 7 || bCnt[c + 1] == 0);
            if (isolated) score += ISOLATED_PAWN;
            boolean passed = true;
            for (int f = c - 1; f <= c + 1 && passed; ++f) {
                if (f < 0 || f > 7) continue;
                for (int rr = r + 1; rr <= 7; ++rr)
                    if (b[rr][f] == 'P') { passed = false; break; }
            }
            if (passed) score -= PASSED_PAWN_BASE + PASSED_PAWN_PER_RANK * (r - 1);
        }
        return score;
    }

    // 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
    // 兵盾：王前方一行（白 r-1 / 黑 r+1）3 格（王列 ±1，越界跳过）每缺一己方兵扣分；
    // 敞开线：王自家 file 在王前方已无任何己方兵再扣分。
    static int KingSafetyScore(GameState state) {
        char[][] b = state.board;
        int[] wk = null, bk = null;
        for (int r = 0; r < 8; ++r)
            for (int c = 0; c < 8; ++c) {
                if (b[r][c] == 'K') wk = new int[]{r, c};
                else if (b[r][c] == 'k') bk = new int[]{r, c};
            }
        if (wk == null || bk == null) return 0;
        int score = 0;
        if (wk[0] >= 6) {
            for (int c = Math.max(0, wk[1] - 1); c <= Math.min(7, wk[1] + 1); ++c)
                if (b[wk[0] - 1][c] != 'P') score -= PAWN_SHIELD_MISSING;
            boolean shielded = false;
            for (int r = wk[0] - 1; r >= 0; --r)
                if (b[r][wk[1]] == 'P') { shielded = true; break; }
            if (!shielded) score -= PAWN_SHIELD_OPEN_FILE;
        }
        if (bk[0] <= 1) {
            for (int c = Math.max(0, bk[1] - 1); c <= Math.min(7, bk[1] + 1); ++c)
                if (b[bk[0] + 1][c] != 'p') score += PAWN_SHIELD_MISSING;
            boolean shielded = false;
            for (int r = bk[0] + 1; r <= 7; ++r)
                if (b[r][bk[1]] == 'p') { shielded = true; break; }
            if (!shielded) score += PAWN_SHIELD_OPEN_FILE;
        }
        return score;
    }

    // 双象分（白方视角差值）。
    static int BishopPairScore(GameState state) {
        int wb = 0, bb = 0;
        char[][] b = state.board;
        for (int r = 0; r < 8; ++r)
            for (int c = 0; c < 8; ++c) {
                if (b[r][c] == 'B') ++wb;
                else if (b[r][c] == 'b') ++bb;
            }
        int score = 0;
        if (wb >= 2) score += BISHOP_PAIR;
        if (bb >= 2) score -= BISHOP_PAIR;
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
