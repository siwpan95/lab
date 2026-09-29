// =============================================================================
// ChessAI.cs — AI 对弈引擎（C#，逐条对齐 C++ 参考 chess_ai.h/.cpp）
// -----------------------------------------------------------------------------
// 架构：
//   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
//   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
//   3. 终局评分：将死 ±900000（越快将死分越高）、逼和 = 0
//
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// 性能：搜索路径使用 GameState.CloneLight() + ApplyMove(recordHistory:false)
// =============================================================================

using System;
using System.Collections.Generic;

namespace ChessEngine
{
    public static class AIEngine
    {
        public const int MateScore = 900000;   // 将死基准分
        public const int Infinity = 1000000;   // 有界无穷大
        // 重复惩罚：当叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过）中时，
        // 按出现次数扣分（白方视角）。引导搜索规避重复局面、减少三重复和棋。约半兵，足以
        // 影响平手选择又不至于为避重而弃子。对齐 go/js 的 RepetitionPenalty=60。
        public const int RepetitionPenalty = 60;

        // ---------------------------- 子力价值（厘兵单位） ----------------------------
        // 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
        public static readonly int[] PieceValue = { 0, 100, 320, 330, 500, 900, 0 };

        // ---------------------------- 位置价值表 PST（白方视角） ----------------------------
        private static readonly int[] PST_Pawn = {
            0,  0,  0,  0,  0,  0,  0,  0,
           50, 50, 50, 50, 50, 50, 50, 50,
           10, 10, 20, 30, 30, 20, 10, 10,
            5,  5, 10, 25, 25, 10,  5,  5,
            0,  0,  0, 20, 20,  0,  0,  0,
            5, -5,-10,  0,  0,-10, -5,  5,
            5, 10, 10,-20,-20, 10, 10,  5,
            0,  0,  0,  0,  0,  0,  0,  0
        };
        private static readonly int[] PST_Knight = {
          -50,-40,-30,-30,-30,-30,-40,-50,
          -40,-20,  0,  0,  0,  0,-20,-40,
          -30,  0, 10, 15, 15, 10,  0,-30,
          -30,  5, 15, 20, 20, 15,  5,-30,
          -30,  0, 15, 20, 20, 15,  0,-30,
          -30,  5, 10, 15, 15, 10,  5,-30,
          -40,-20,  0,  5,  5,  0,-20,-40,
          -50,-40,-30,-30,-30,-30,-40,-50
        };
        private static readonly int[] PST_Bishop = {
          -20,-10,-10,-10,-10,-10,-10,-20,
          -10,  0,  0,  0,  0,  0,  0,-10,
          -10,  0,  5, 10, 10,  5,  0,-10,
          -10,  5,  5, 10, 10,  5,  5,-10,
          -10,  0, 10, 10, 10, 10,  0,-10,
          -10, 10, 10, 10, 10, 10, 10,-10,
          -10,  5,  0,  0,  0,  0,  5,-10,
          -20,-10,-10,-10,-10,-10,-10,-20
        };
        private static readonly int[] PST_Rook = {
            0,  0,  0,  0,  0,  0,  0,  0,
            5, 10, 10, 10, 10, 10, 10,  5,
           -5,  0,  0,  0,  0,  0,  0, -5,
           -5,  0,  0,  0,  0,  0,  0, -5,
           -5,  0,  0,  0,  0,  0,  0, -5,
           -5,  0,  0,  0,  0,  0,  0, -5,
           -5,  0,  0,  0,  0,  0,  0, -5,
            0,  0,  0,  5,  5,  0,  0,  0
        };
        private static readonly int[] PST_Queen = {
          -20,-10,-10, -5, -5,-10,-10,-20,
          -10,  0,  0,  0,  0,  0,  0,-10,
          -10,  0,  5,  5,  5,  5,  0,-10,
           -5,  0,  5,  5,  5,  5,  0, -5,
            0,  0,  5,  5,  5,  5,  0, -5,
          -10,  5,  5,  5,  5,  5,  0,-10,
          -10,  0,  5,  0,  0,  0,  0,-10,
          -20,-10,-10, -5, -5,-10,-10,-20
        };
        private static readonly int[] PST_King = {
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
        private static int PieceIndex(char p)
        {
            switch (char.ToUpperInvariant(p))
            {
                case 'P': return 1;
                case 'N': return 2;
                case 'B': return 3;
                case 'R': return 4;
                case 'Q': return 5;
                case 'K': return 6;
                default: return 0;
            }
        }

        private static int GetPST(int pieceIdx, int pos)
        {
            switch (pieceIdx)
            {
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
        public static int Evaluate(GameState state)
        {
            int score = 0;
            char[,] b = state.Board;
            for (int r = 0; r < 8; ++r)
            {
                for (int c = 0; c < 8; ++c)
                {
                    char p = b[r, c];
                    if (p == '.') continue;
                    int idx = PieceIndex(p);
                    int pos = r * 8 + c;
                    if (char.IsUpper(p))
                    {
                        score += PieceValue[idx] + GetPST(idx, pos);
                    }
                    else
                    {
                        score -= PieceValue[idx] + GetPST(idx, (7 - r) * 8 + c);
                    }
                }
            }
            // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
            if (state.RepHistory != null)
            {
                string key = state.PositionKeySimple();
                if (state.RepHistory.TryGetValue(key, out int cnt) && cnt > 0)
                {
                    score -= RepetitionPenalty * cnt;
                }
            }
            return score;
        }

        // 当前行棋方视角分数（negamax 约定）
        private static int EvaluateSide(GameState state)
        {
            int s = Evaluate(state);
            return state.WhiteToMove ? s : -s;
        }

        // ---------------------------- 走法排序（MVV-LVA） ----------------------------
        private static int MoveOrderScore(Move m)
        {
            if (m.Captured == '.') return 0;
            int victim = PieceValue[PieceIndex(m.Captured)];
            int attacker = PieceValue[PieceIndex(m.Piece)];
            return victim * 10 - attacker;
        }

        private static void OrderMoves(List<Move> moves)
        {
            // 与 C++ std::sort 一致：按 MoveOrderScore 降序（不保证等分走法的相对次序）
            moves.Sort((a, b) => MoveOrderScore(b) - MoveOrderScore(a));
        }

        // ---------------------------- 静态搜索（quiescence） ----------------------------
        public static int Quiescence(GameState state, int alpha, int beta, int qdepth)
        {
            int stand = EvaluateSide(state);
            if (stand >= beta) return beta;
            if (stand > alpha) alpha = stand;
            if (qdepth >= 4) return alpha;

            List<Move> captures = new List<Move>();
            foreach (Move m in Rules.GenerateAllLegalMoves(state))
                if (m.Captured != '.') captures.Add(m);
            OrderMoves(captures);

            foreach (Move m in captures)
            {
                GameState child = state.CloneLight();
                Rules.ApplyMove(child, m, false);
                int score = -Quiescence(child, -beta, -alpha, qdepth + 1);
                if (score >= beta) return beta;
                if (score > alpha) alpha = score;
            }
            return alpha;
        }

        // ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
        public static int Negamax(GameState state, int depth, int alpha, int beta, int ply)
        {
            List<Move> moves = Rules.GenerateAllLegalMoves(state);

            if (moves.Count == 0)
            {
                if (Rules.IsInCheck(state, state.WhiteToMove))
                    return -MateScore + ply; // 被将死：离根越近越差
                return 0; // 逼和
            }

            if (depth <= 0)
                return Quiescence(state, alpha, beta, 0);

            OrderMoves(moves);

            int best = -Infinity;
            foreach (Move m in moves)
            {
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
        // 无合法走法时返回 null（对齐 C++ std::nullopt）
        public static Move? FindBestMove(GameState state, int depth)
        {
            List<Move> moves = Rules.GenerateAllLegalMoves(state);
            if (moves.Count == 0) return null;
            if (moves.Count == 1) return moves[0];

            OrderMoves(moves);

            Move bestMove = moves[0];
            int bestScore = -Infinity;
            int alpha = -Infinity;
            int beta = Infinity;

            foreach (Move m in moves)
            {
                GameState child = state.CloneLight();
                Rules.ApplyMove(child, m, false);
                int score = -Negamax(child, depth - 1, -beta, -alpha, 1);
                if (score > bestScore)
                {
                    bestScore = score;
                    bestMove = m;
                }
                if (score > alpha) alpha = score;
            }
            return bestMove;
        }
    }
}
