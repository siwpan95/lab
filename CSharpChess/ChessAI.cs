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

        // ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
        // 与 JsChess/chessAI.js 的 EVAL_PROFILE、chess-cordis drivers/go 的 EvalProfileSpec
        // 同构：每引擎一份独立 profile，术语全部是白黑严格镜像差值（初始对称局面评估仍为 0）。
        // 字段顺序与 ProfileHash 的规范化串即契约，验收门 tournament/validate_eval_profile.mjs
        // 用同一 djb2-32 算法独立重算比对。
        public const string ProfileName = "kingsafety";
        public const int PawnShieldMissing = 35;  // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
        public const int PawnShieldOpenFile = 25; // 王自家线在王前方已无任何己方兵
        public const int DoubledPawn = 10;        // 每个叠兵（同线多出的每一个）
        public const int IsolatedPawn = 12;       // 每个孤兵（相邻线无己方兵）
        public const int PassedPawnBase = 15;     // 通路兵基础分
        public const int PassedPawnPerRank = 5;   // 通路兵每向升变推进一行的加成
        public const int BishopPair = 15;         // 双象
        public const int MobilityWeight = 0;      // 预留：机动性每步权重（试点关闭）

        // ProfileHash：profile 规范化串的 djb2-32，与 JS 侧 evalProfileHash 逐字节同算法。
        // 规范化串 "kingsafety|35|25|10|12|15|5|15|0"（整数无空格），期望 hash = 28fa8b3e。
        public static string ProfileHash()
        {
            string s = ProfileName + "|" + PawnShieldMissing + "|" + PawnShieldOpenFile +
                       "|" + DoubledPawn + "|" + IsolatedPawn + "|" + PassedPawnBase +
                       "|" + PassedPawnPerRank + "|" + BishopPair + "|" + MobilityWeight;
            uint h = 5381u;
            foreach (byte b in System.Text.Encoding.ASCII.GetBytes(s))
                h = h * 33 + b; // 自然回绕
            return h.ToString("x8");
        }

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
            // Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
            // 保持「初始局面评估 = 0」的对称性不变量。
            score += PawnStructureScore(state);
            score += KingSafetyScore(state);
            score += BishopPairScore(state);
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

        // ---------------------------- Tier 2-C 风格术语（白黑镜像差值） ----------------------------

        // 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
        public static int PawnStructureScore(GameState state)
        {
            char[,] b = state.Board;
            int[] wCnt = new int[8];
            int[] bCnt = new int[8];
            List<(int r, int c)> wPawns = new List<(int, int)>();
            List<(int r, int c)> bPawns = new List<(int, int)>();
            for (int r = 0; r < 8; ++r)
            {
                for (int c = 0; c < 8; ++c)
                {
                    if (b[r, c] == 'P') { wCnt[c]++; wPawns.Add((r, c)); }
                    else if (b[r, c] == 'p') { bCnt[c]++; bPawns.Add((r, c)); }
                }
            }
            int score = 0;
            for (int c = 0; c < 8; ++c)
            {
                if (wCnt[c] > 1) score -= DoubledPawn * (wCnt[c] - 1);
                if (bCnt[c] > 1) score += DoubledPawn * (bCnt[c] - 1);
            }
            foreach ((int r, int c) in wPawns)
            {
                bool isolated = (c == 0 || wCnt[c - 1] == 0) && (c == 7 || wCnt[c + 1] == 0);
                if (isolated) score -= IsolatedPawn;
                bool passed = true;
                for (int f = c - 1; f <= c + 1 && passed; ++f)
                {
                    if (f < 0 || f > 7) continue;
                    for (int rr = r - 1; rr >= 0; --rr)
                        if (b[rr, f] == 'p') { passed = false; break; }
                }
                if (passed) score += PassedPawnBase + PassedPawnPerRank * (6 - r);
            }
            foreach ((int r, int c) in bPawns)
            {
                bool isolated = (c == 0 || bCnt[c - 1] == 0) && (c == 7 || bCnt[c + 1] == 0);
                if (isolated) score += IsolatedPawn;
                bool passed = true;
                for (int f = c - 1; f <= c + 1 && passed; ++f)
                {
                    if (f < 0 || f > 7) continue;
                    for (int rr = r + 1; rr <= 7; ++rr)
                        if (b[rr, f] == 'P') { passed = false; break; }
                }
                if (passed) score -= PassedPawnBase + PassedPawnPerRank * (r - 1);
            }
            return score;
        }

        // 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
        public static int KingSafetyScore(GameState state)
        {
            char[,] b = state.Board;
            int wkR = -1, wkC = -1, bkR = -1, bkC = -1;
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                {
                    if (b[r, c] == 'K') { wkR = r; wkC = c; }
                    else if (b[r, c] == 'k') { bkR = r; bkC = c; }
                }
            if (wkR < 0 || bkR < 0) return 0;
            int score = 0;
            if (wkR >= 6)
            {
                for (int c = wkC - 1; c <= wkC + 1; ++c)
                {
                    if (c < 0 || c > 7) continue;
                    if (b[wkR - 1, c] != 'P') score -= PawnShieldMissing;
                }
                bool shielded = false;
                for (int r = wkR - 1; r >= 0; --r)
                    if (b[r, wkC] == 'P') { shielded = true; break; }
                if (!shielded) score -= PawnShieldOpenFile;
            }
            if (bkR <= 1)
            {
                for (int c = bkC - 1; c <= bkC + 1; ++c)
                {
                    if (c < 0 || c > 7) continue;
                    if (b[bkR + 1, c] != 'p') score += PawnShieldMissing;
                }
                bool shielded = false;
                for (int r = bkR + 1; r <= 7; ++r)
                    if (b[r, bkC] == 'p') { shielded = true; break; }
                if (!shielded) score += PawnShieldOpenFile;
            }
            return score;
        }

        // 双象分（白方视角差值）。
        public static int BishopPairScore(GameState state)
        {
            char[,] b = state.Board;
            int wb = 0, bb = 0;
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                {
                    if (b[r, c] == 'B') ++wb;
                    else if (b[r, c] == 'b') ++bb;
                }
            int score = 0;
            if (wb >= 2) score += BishopPair;
            if (bb >= 2) score -= BishopPair;
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
