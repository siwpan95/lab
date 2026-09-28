// =============================================================================
// Tests.cs — 核心规则自测（C#，逐条对齐 C++ 参考 tests.cpp 的 24 组 / 97 项断言）
// 覆盖：初始走法数 / 过路兵 / 王车易位 / 升变 / 将死（学者杀、愚兄杀）/
//       逼和 / 子力不足 / 50 步计数 / IsAttacked 基础语义 / 钉死 / 逃将 /
//       EP 揭开将军 / 子力不足扩展 / 深度3计时 / 角格车被吃撤销易位权 /
//       退化局面 / 升变 SAN
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace ChessEngine
{
    public static class Tests
    {
        private static int g_pass = 0;
        private static int g_fail = 0;

        private static void Check(string name, bool cond)
        {
            if (cond)
            {
                ++g_pass;
                Console.WriteLine("[PASS] " + name);
            }
            else
            {
                ++g_fail;
                Console.WriteLine("[FAIL] " + name);
            }
        }

        // 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
        private static Move FindMove(GameState state, int r, int c, int tr, int tc)
        {
            foreach (Move m in Rules.GenerateLegalMoves(state, r, c))
                if (m.ToRow == tr && m.ToCol == tc) return m;
            throw new InvalidOperationException("move not found");
        }

        // 走一步并返回新状态（深拷贝 + 应用）
        private static GameState Play(GameState state, int r, int c, int tr, int tc)
        {
            Move m = FindMove(state, r, c, tr, tc);
            GameState s = state.Clone();
            Rules.ApplyMove(s, m);
            return s;
        }

        // 清空棋盘上所有棋子（测试用）
        private static void EmptyBoard(GameState s)
        {
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                    s.Board[r, c] = '.';
            s.CanCastleWK = s.CanCastleWQ = s.CanCastleBK = s.CanCastleBQ = false;
            s.EnPassantRow = s.EnPassantCol = -1;
            s.HalfmoveClock = 0; s.FullmoveNumber = 1;
            s.History.Clear(); s.PositionKeys.Clear();
            s.PositionKeys.Add(s.GetPositionKey());
        }

        // ---------- Perft 辅助：FEN 式局面构建 ----------
        // ranks[0] = 第 8 横线（row 0），ranks[7] = 第 1 横线（row 7）
        // 字母 => 该棋子字符；数字 N => N 个空格 '.'
        // 行棋方恒为白方；易位权由 castling 串决定（含 K/Q/k/q 即为真）；无过路兵
        private static GameState SetupPosition(string[] ranks, string castling)
        {
            GameState s = new GameState();
            for (int r = 0; r < 8; ++r)
            {
                string rank = ranks[r];
                int col = 0;
                foreach (char ch in rank)
                {
                    if (char.IsDigit(ch))
                    {
                        int n = ch - '0';
                        for (int k = 0; k < n; ++k) s.Board[r, col++] = '.';
                    }
                    else
                    {
                        s.Board[r, col++] = ch;
                    }
                }
            }
            s.WhiteToMove = true;
            s.CanCastleWK = castling.IndexOf('K') >= 0;
            s.CanCastleWQ = castling.IndexOf('Q') >= 0;
            s.CanCastleBK = castling.IndexOf('k') >= 0;
            s.CanCastleBQ = castling.IndexOf('q') >= 0;
            s.EnPassantRow = -1;
            s.EnPassantCol = -1;
            s.HalfmoveClock = 0;
            s.FullmoveNumber = 1;
            s.History.Clear();
            s.PositionKeys.Clear();
            return s;
        }

        // ---------- Perft：走法生成节点计数（黄金值验证） ----------
        private static long Perft(GameState state, int depth)
        {
            if (depth == 0) return 1;
            List<Move> moves = Rules.GenerateAllLegalMoves(state);
            if (depth == 1) return moves.Count;
            long count = 0;
            foreach (Move m in moves)
            {
                GameState child = state.Clone();   // 与现有测试一致的完整深拷贝
                Rules.ApplyMove(child, m);          // 与现有测试一致的 2 参 ApplyMove
                count += Perft(child, depth - 1);
            }
            return count;
        }

        // ---------- 25. Perft 黄金值断言 ----------
        private static void TestPerft()
        {
            // Pos1 "Start"
            {
                GameState s = SetupPosition(new string[] {
                    "rnbqkbnr","pppppppp","........","........",
                    "........","........","PPPPPPPP","RNBQKBNR" }, "KQkq");
                Check("Perft Start d1 = 20", Perft(s, 1) == 20);
                Check("Perft Start d2 = 400", Perft(s, 2) == 400);
                Check("Perft Start d3 = 8902", Perft(s, 3) == 8902);
                Check("Perft Start d4 = 197281", Perft(s, 4) == 197281);
            }
            // Pos2 "Kiwipete"
            {
                GameState s = SetupPosition(new string[] {
                    "r3k2r","p1ppqpb1","bn2pnp1","3PN3",
                    "1p2P3","2N2Q1p","PPPBBPPP","R3K2R" }, "KQkq");
                Check("Perft Kiwipete d1 = 48", Perft(s, 1) == 48);
                Check("Perft Kiwipete d2 = 2039", Perft(s, 2) == 2039);
                Check("Perft Kiwipete d3 = 97862", Perft(s, 3) == 97862);
                // 参考：Kiwipete d4 = 4085603（>2M 节点，运行较慢，不自动执行）
            }
            // Pos3 "Wiki3"  （注意：规范 FEN 第 2 横线为 4P1P1，原给定 PPP3PP 多放了兵）
            {
                GameState s = SetupPosition(new string[] {
                    "8","2p5","3p4","KP5r",
                    "1R3p1k","8","4P1P1","8" }, "");
                Check("Perft Wiki3 d1 = 14", Perft(s, 1) == 14);
                Check("Perft Wiki3 d2 = 191", Perft(s, 2) == 191);
                Check("Perft Wiki3 d3 = 2812", Perft(s, 3) == 2812);
                Check("Perft Wiki3 d4 = 43238", Perft(s, 4) == 43238);
            }
            // Pos4 "Wiki5"
            {
                GameState s = SetupPosition(new string[] {
                    "rnbq1k1r","pp1Pbppp","2p5","8",
                    "2B5","8","PPP1NnPP","RNBQK2R" }, "KQ");
                Check("Perft Wiki5 d1 = 44", Perft(s, 1) == 44);
                Check("Perft Wiki5 d2 = 1486", Perft(s, 2) == 1486);
                Check("Perft Wiki5 d3 = 62379", Perft(s, 3) == 62379);
                // 参考：Wiki5 d4 = 2103487（>2M 节点，运行较慢，不自动执行）
            }
        }

        // ---------- 1. 初始局面 ----------
        private static void TestInitialPosition()
        {
            GameState s = new GameState();
            Check("初始局面白方合法走法数 = 20", Rules.GenerateAllLegalMoves(s).Count == 20);
            Check("初始局面 b1 马走法数 = 2", Rules.GenerateLegalMoves(s, 7, 1).Count == 2);
            Check("初始局面 g1 马走法数 = 2", Rules.GenerateLegalMoves(s, 7, 6).Count == 2);
            Check("初始局面 e2 兵走法数 = 2", Rules.GenerateLegalMoves(s, 6, 4).Count == 2);
            Check("初始局面 d1 后走法数 = 0", Rules.GenerateLegalMoves(s, 7, 3).Count == 0);
            Check("初始局面白王不被将军", !Rules.IsInCheck(s, true));
            Check("初始局面黑王不被将军", !Rules.IsInCheck(s, false));
            Check("初始局面非将死", !Rules.IsCheckmate(s));

            GameState b = new GameState();
            b.WhiteToMove = false;
            Check("初始局面黑方合法走法数 = 20", Rules.GenerateAllLegalMoves(b).Count == 20);
        }

        // ---------- 2. IsAttacked 基础语义 ----------
        private static void TestIsAttackedBasics()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[4, 4] = 'P'; // 白兵 e4
            s.Board[3, 4] = 'p'; // 黑兵 e5
            s.Board[7, 4] = 'K'; // 白王 e1
            s.Board[0, 4] = 'k'; // 黑王 e8

            Check("白兵 e4 攻击 d5", Rules.IsAttacked(s.Board, 3, 3, true));
            Check("白兵 e4 攻击 f5", Rules.IsAttacked(s.Board, 3, 5, true));
            Check("白兵 e4 不攻击 e5（兵不直吃）", !Rules.IsAttacked(s.Board, 3, 4, true));
            Check("黑兵 e5 攻击 d4", Rules.IsAttacked(s.Board, 4, 3, false));
            Check("黑兵 e5 攻击 f4", Rules.IsAttacked(s.Board, 4, 5, false));
            Check("a1 格不被任何方攻击", !Rules.IsAttacked(s.Board, 7, 0, true) && !Rules.IsAttacked(s.Board, 7, 0, false));
            Check("白王 e1 攻击 e2", Rules.IsAttacked(s.Board, 6, 4, true));
        }

        // ---------- 3. 双进兵与吃过路兵 ----------
        private static void TestPawnDoubleAndEnPassant()
        {
            GameState s = new GameState();
            s = Play(s, 6, 4, 4, 4); // 1. e2-e4
            Check("e4 双进兵设置过路兵格 (5,4)", s.EnPassantRow == 5 && s.EnPassantCol == 4);
            Check("双进兵后半步计数 = 0", s.HalfmoveClock == 0);
            Check("e4 后轮黑方", !s.WhiteToMove);

            GameState t = new GameState(); EmptyBoard(t);
            t.Board[3, 4] = 'P'; // 白兵 e5
            t.Board[1, 3] = 'p'; // 黑兵 d7（将双走进 d5）
            t.WhiteToMove = false;
            t = Play(t, 1, 3, 3, 3); // 黑 d7-d5 → ep 目标 d6 (2,3)
            Check("黑 d5 双进后轮白方", t.WhiteToMove);

            List<Move> pawnMoves = Rules.GenerateLegalMoves(t, 3, 4);
            bool hasEP = false;
            foreach (Move m in pawnMoves) if (m.Special == SpecialMove.EnPassant) hasEP = true;
            Check("白 e5 兵存在吃过路兵走法", hasEP);

            Move epMove = new Move();
            foreach (Move m in pawnMoves) if (m.Special == SpecialMove.EnPassant) { epMove = m; break; }
            GameState after = t.Clone();
            Rules.ApplyMove(after, epMove);
            Check("过路兵吃后白兵位于 d6", after.Board[2, 3] == 'P');
            Check("过路兵吃后黑 d5 兵被移除", after.Board[3, 3] == '.');
            Check("过路兵吃后过路兵格已清空", after.EnPassantRow == -1);
        }

        // ---------- 4. 王车易位 ----------
        private static void TestCastling()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 4] = 'K'; s.Board[7, 7] = 'R'; s.Board[7, 0] = 'R';
            s.Board[0, 4] = 'k';
            s.CanCastleWK = s.CanCastleWQ = s.CanCastleBK = s.CanCastleBQ = true;

            List<Move> kingMoves = Rules.GenerateLegalMoves(s, 7, 4);
            bool castleK = false, castleQ = false;
            foreach (Move m in kingMoves)
            {
                if (m.Special == SpecialMove.CastleKingside) castleK = true;
                if (m.Special == SpecialMove.CastleQueenside) castleQ = true;
            }
            Check("白王可短易位", castleK);
            Check("白王可长易位", castleQ);

            Move mv = new Move();
            foreach (Move m in Rules.GenerateLegalMoves(s, 7, 4))
                if (m.Special == SpecialMove.CastleKingside) { mv = m; break; }
            GameState after = s.Clone();
            Rules.ApplyMove(after, mv);
            Check("短易位后白王位于 g1", after.Board[7, 6] == 'K');
            Check("短易位后白车位于 f1", after.Board[7, 5] == 'R');
            Check("短易位后 h1 为空", after.Board[7, 7] == '.');
            Check("短易位后白方失去全部易位权", !after.CanCastleWK && !after.CanCastleWQ);

            GameState blocked = s.Clone();
            blocked.Board[3, 3] = 'r'; // 黑车 d5，攻击 d1
            List<Move> km = Rules.GenerateLegalMoves(blocked, 7, 4);
            bool castleQBlocked = false;
            foreach (Move m in km) if (m.Special == SpecialMove.CastleQueenside) castleQBlocked = true;
            Check("路径 d1 被攻击时长易位被禁止", !castleQBlocked);

            GameState inCheck = s.Clone();
            inCheck.Board[3, 4] = 'r'; // 黑车 e5 攻击 e1
            km = Rules.GenerateLegalMoves(inCheck, 7, 4);
            bool anyCastle = false;
            foreach (Move m in km)
                if (m.Special == SpecialMove.CastleKingside || m.Special == SpecialMove.CastleQueenside) anyCastle = true;
            Check("王被将军时禁止易位", !anyCastle);
        }

        // ---------- 5. 兵升变 ----------
        private static void TestPromotion()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[1, 4] = 'P'; s.Board[7, 4] = 'K'; s.Board[0, 7] = 'k';

            List<Move> moves = Rules.GenerateLegalMoves(s, 1, 4);
            int promoCount = 0;
            foreach (Move m in moves) if (m.Special == SpecialMove.Promotion) ++promoCount;
            Check("e7 兵生成 4 种升变走法（Q/R/B/N）", promoCount == 4);

            Move mv = new Move();
            foreach (Move m in Rules.GenerateLegalMoves(s, 1, 4))
                if (m.Special == SpecialMove.Promotion && m.Promotion == 'Q') { mv = m; break; }
            GameState after = s.Clone();
            Rules.ApplyMove(after, mv);
            Check("升变后 e8 为白后", after.Board[0, 4] == 'Q');
            Check("升变后 e7 为空", after.Board[1, 4] == '.');
        }

        // ---------- 6. 学者将杀 ----------
        private static void TestScholarMate()
        {
            GameState s = new GameState();
            s = Play(s, 6, 4, 4, 4); // 1. e4
            s = Play(s, 1, 4, 3, 4); // 1... e5
            s = Play(s, 7, 5, 4, 2); // 2. Bf1-c4
            s = Play(s, 0, 1, 2, 2); // 2... Nb8-c6
            s = Play(s, 7, 3, 3, 7); // 3. Qd1-h5
            s = Play(s, 0, 6, 2, 5); // 3... Ng8-f6
            s = Play(s, 3, 7, 1, 5); // 4. Qh5xf7#

            Check("学者将杀：黑方被将军", Rules.IsInCheck(s, false));
            Check("学者将杀：IsCheckmate = True", Rules.IsCheckmate(s));
            Check("学者将杀：非逼和", !Rules.IsStalemate(s));
            Check("学者将杀后轮黑方", !s.WhiteToMove);
        }

        // ---------- 7. 愚兄杀 ----------
        private static void TestFoolMate()
        {
            GameState s = new GameState();
            s = Play(s, 6, 5, 5, 5); // 1. f3
            s = Play(s, 1, 4, 3, 4); // 1... e5
            s = Play(s, 6, 6, 4, 6); // 2. g4
            s = Play(s, 0, 3, 4, 7); // 2... Qd8-h4#

            Check("愚兄杀：白方被将军", Rules.IsInCheck(s, true));
            Check("愚兄杀：IsCheckmate = True", Rules.IsCheckmate(s));
        }

        // ---------- 8. 逼和 ----------
        private static void TestStalemate()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[0, 7] = 'k'; s.Board[1, 5] = 'Q'; s.Board[2, 6] = 'K';
            s.WhiteToMove = false;

            Check("逼和局面：黑方不被将军", !Rules.IsInCheck(s, false));
            Check("逼和局面：黑方合法走法数 = 0", Rules.GenerateAllLegalMoves(s).Count == 0);
            Check("逼和局面：IsStalemate = True", Rules.IsStalemate(s));
            Check("逼和局面：非将死", !Rules.IsCheckmate(s));
        }

        // ---------- 9. 子力不足 ----------
        private static void TestInsufficientMaterial()
        {
            GameState kk = new GameState(); EmptyBoard(kk);
            kk.Board[7, 4] = 'K'; kk.Board[0, 4] = 'k';
            Check("仅剩双王 = 子力不足", Rules.IsInsufficientMaterial(kk));

            kk.Board[4, 4] = 'N';
            Check("王+单马 vs 王 = 子力不足", Rules.IsInsufficientMaterial(kk));

            kk.Board[4, 4] = 'b';
            Check("王+单象 vs 王 = 子力不足", Rules.IsInsufficientMaterial(kk));

            kk.Board[4, 4] = 'P';
            Check("王+兵 vs 王 ≠ 子力不足", !Rules.IsInsufficientMaterial(kk));

            kk.Board[4, 4] = 'R';
            Check("王+车 vs 王 ≠ 子力不足", !Rules.IsInsufficientMaterial(kk));

            GameState full = new GameState();
            Check("初始局面 ≠ 子力不足", !Rules.IsInsufficientMaterial(full));
        }

        // ---------- 10. 50 步规则计数 ----------
        private static void TestFiftyMoveCounter()
        {
            GameState s = new GameState();
            s = Play(s, 7, 6, 5, 5); // 1. Ng1-f3
            Check("马走一步后半步计数 = 1", s.HalfmoveClock == 1);
            s = Play(s, 0, 6, 2, 5); // 1... Ng8-f6
            Check("两步非兵非吃后半步计数 = 2", s.HalfmoveClock == 2);
            s = Play(s, 5, 5, 7, 6); // 2. Nf3-g1
            Check("三步后半步计数 = 3", s.HalfmoveClock == 3);
            s = Play(s, 2, 5, 0, 6); // 2... Nf6-g8
            Check("四步后半步计数 = 4", s.HalfmoveClock == 4);
            s = Play(s, 6, 4, 4, 4); // 3. e4（动兵清零）
            Check("动兵后半步计数清零", s.HalfmoveClock == 0);
            Check("未达 100 半步不判 50 步和棋", !Rules.IsFiftyMoveDraw(s));

            GameState forced = new GameState(); forced.HalfmoveClock = 100;
            Check("100 半步判 50 步和棋", Rules.IsFiftyMoveDraw(forced));
        }

        // ---------- 11. 三次重复局面判和 ----------
        private static void TestThreefoldRepetition()
        {
            GameState s = new GameState();
            s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 6, 2, 5);
            s = Play(s, 5, 5, 7, 6); s = Play(s, 2, 5, 0, 6);
            Check("4 步往返后局面重复第 2 次（不判和）", !Rules.IsThreefoldRepetition(s));

            s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 6, 2, 5);
            s = Play(s, 5, 5, 7, 6); s = Play(s, 2, 5, 0, 6);
            Check("8 步往返后局面重复第 3 次（判和）", Rules.IsThreefoldRepetition(s));

            s = Play(s, 6, 4, 4, 4);
            Check("走出新局面后不再判和", !Rules.IsThreefoldRepetition(s));
        }

        // ---------- 12. 评估函数 ----------
        private static void TestEvaluation()
        {
            GameState s = new GameState();
            Check("初始局面评估 = 0（对称）", AIEngine.Evaluate(s) == 0);
            s.Board[4, 4] = 'P';
            int score1 = AIEngine.Evaluate(s);
            Check("白方多一兵 → 评估为正", score1 > 0);
            s.Board[3, 3] = 'n';
            int score2 = AIEngine.Evaluate(s);
            Check("黑方多一马压过白方一兵 → 评估为负", score2 < 0);
        }

        // ---------- 13. Negamax 终局评分 ----------
        private static void TestNegamaxTerminalScores()
        {
            GameState s = new GameState();
            s = Play(s, 6, 4, 4, 4); s = Play(s, 1, 4, 3, 4);
            s = Play(s, 7, 5, 4, 2); s = Play(s, 0, 1, 2, 2);
            s = Play(s, 7, 3, 3, 7); s = Play(s, 0, 6, 2, 5);
            s = Play(s, 3, 7, 1, 5); // 4. Qxf7#
            int mateScore = AIEngine.Negamax(s, 2, -AIEngine.Infinity, AIEngine.Infinity, 0);
            Check("将死局面 negamax 返回大负数", mateScore <= -9000);

            GameState st = new GameState(); EmptyBoard(st);
            st.Board[0, 7] = 'k'; st.Board[1, 5] = 'Q'; st.Board[2, 6] = 'K';
            st.WhiteToMove = false;
            st.PositionKeys.Clear(); st.PositionKeys.Add(st.GetPositionKey());
            int staleScore = AIEngine.Negamax(st, 2, -AIEngine.Infinity, AIEngine.Infinity, 0);
            Check("逼和局面 negamax 返回 0", staleScore == 0);
        }

        // ---------- 14. AI 一步杀 ----------
        private static void TestAIFindsMate()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[2, 1] = 'K'; s.Board[7, 7] = 'Q'; s.Board[0, 0] = 'k';
            s.WhiteToMove = true;
            s.PositionKeys.Clear(); s.PositionKeys.Add(s.GetPositionKey());

            Move? best = AIEngine.FindBestMove(s, 2);
            GameState after = s.Clone();
            Rules.ApplyMove(after, best!);
            Check("AI 深度 2 找到一步杀（Qh8#）", Rules.IsCheckmate(after));
        }

        // ---------- 15. AI 白吃无保护后 ----------
        private static void TestAICapturesFreeQueen()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 3] = 'Q'; s.Board[7, 4] = 'K'; s.Board[0, 3] = 'q'; s.Board[0, 7] = 'k';
            s.WhiteToMove = true;
            s.PositionKeys.Clear(); s.PositionKeys.Add(s.GetPositionKey());

            Move? best = AIEngine.FindBestMove(s, 2);
            Check("AI 深度 2 捕获无保护黑后",
                  best != null && best.ToRow == 0 && best.ToCol == 3 && best.Captured == 'q');
        }

        // ---------- 16. AI 开局合理性 ----------
        private static void TestAIChooseReasonableOpening()
        {
            GameState s = new GameState();
            Stopwatch sw = Stopwatch.StartNew();
            Move? best = AIEngine.FindBestMove(s, 2);
            sw.Stop();
            bool isLegal = false;
            if (best != null)
            {
                foreach (Move m in Rules.GenerateAllLegalMoves(s))
                    if (m.FromRow == best.FromRow && m.FromCol == best.FromCol &&
                        m.ToRow == best.ToRow && m.ToCol == best.ToCol) isLegal = true;
            }
            Check("初始局面 AI 返回合法走法", isLegal);
            long ms = sw.ElapsedMilliseconds;
            Check("AI 深度 2 初始局面搜索 < 5 秒", ms < 5000);
        }

        // ---------- 17. 被钉死棋子限制 ----------
        private static void TestPinnedPiece()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 3] = 'K'; s.Board[6, 3] = 'B'; s.Board[0, 3] = 'r'; s.Board[0, 4] = 'k';
            Check("钉死前象存在伪合法走法", Rules.GeneratePseudoMoves(s, 6, 3).Count != 0);
            Check("被钉死象无合法走法", Rules.GenerateLegalMoves(s, 6, 3).Count == 0);
            Check("钉死局面白王未被将军", !Rules.IsInCheck(s, true));
        }

        // ---------- 18. 被将军时合法走法枚举 ----------
        private static void TestCheckEvasion()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 4] = 'K'; s.Board[0, 4] = 'r'; s.Board[0, 0] = 'k';
            Check("逃将局面白王被将军", Rules.IsInCheck(s, true));
            List<Move> legal = Rules.GenerateAllLegalMoves(s);
            Check("被将军时合法走法均为逃着（>0）", legal.Count != 0);
            bool allResolve = true;
            foreach (Move m in legal)
            {
                GameState after = s.Clone();
                Rules.ApplyMove(after, m);
                if (Rules.IsInCheck(after, true)) allResolve = false;
            }
            Check("每个合法走法均解除将军", allResolve);
        }

        // ---------- 19. 过路兵吃子揭开己方王 ----------
        private static void TestEnPassantRevealCheck()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[3, 0] = 'K'; s.Board[3, 7] = 'r'; s.Board[3, 3] = 'P'; s.Board[3, 4] = 'p';
            s.WhiteToMove = true;
            s.EnPassantRow = 2; s.EnPassantCol = 4;
            s.PositionKeys.Clear();
            Check("EP 揭开将军：当前白王未被将军", !Rules.IsInCheck(s, true));
            List<Move> legal = Rules.GenerateLegalMoves(s, 3, 3);
            bool hasEP = false;
            foreach (Move m in legal) if (m.Special == SpecialMove.EnPassant) hasEP = true;
            Check("EP 吃子会揭开己方王 → 不出现在合法走法中", !hasEP);
        }

        // ---------- 20. 子力不足扩展 ----------
        private static void TestInsufficientMaterialExtended()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 4] = 'K'; s.Board[0, 4] = 'k';
            Check("KK = 子力不足", Rules.IsInsufficientMaterial(s));
            s.Board[7, 1] = 'N';
            Check("KN vs K = 子力不足", Rules.IsInsufficientMaterial(s));
            s.Board[7, 2] = 'N';
            Check("KNN vs K = 子力不足", Rules.IsInsufficientMaterial(s));

            GameState kb = new GameState(); EmptyBoard(kb);
            kb.Board[7, 4] = 'K'; kb.Board[0, 4] = 'k';
            kb.Board[7, 2] = 'B'; kb.Board[0, 3] = 'b';
            Check("KB vs KB = 子力不足", Rules.IsInsufficientMaterial(kb));

            GameState kbb = new GameState(); EmptyBoard(kbb);
            kbb.Board[7, 4] = 'K'; kbb.Board[0, 4] = 'k';
            kbb.Board[7, 2] = 'B'; kbb.Board[7, 5] = 'B';
            Check("KBB 异色格双象可杀 ≠ 子力不足", !Rules.IsInsufficientMaterial(kbb));

            GameState kbn = new GameState(); EmptyBoard(kbn);
            kbn.Board[7, 4] = 'K'; kbn.Board[0, 4] = 'k';
            kbn.Board[7, 2] = 'B'; kbn.Board[7, 1] = 'N';
            Check("KBN vs K 可杀 ≠ 子力不足", !Rules.IsInsufficientMaterial(kbn));

            GameState kr = new GameState(); EmptyBoard(kr);
            kr.Board[7, 4] = 'K'; kr.Board[0, 4] = 'k'; kr.Board[7, 0] = 'R';
            Check("K + 车 vs K 可杀 ≠ 子力不足", !Rules.IsInsufficientMaterial(kr));
        }

        // ---------- 21. AI 深度 3 性能 ----------
        private static void TestDepth3Timing()
        {
            GameState s = new GameState();
            s = Play(s, 6, 4, 4, 4); s = Play(s, 1, 4, 3, 4);
            s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 1, 2, 2);
            s = Play(s, 7, 5, 4, 2); s = Play(s, 0, 6, 2, 5);
            Stopwatch sw = Stopwatch.StartNew();
            Move? best = AIEngine.FindBestMove(s, 3);
            sw.Stop();
            bool isLegal = false;
            if (best != null)
                foreach (Move m in Rules.GenerateAllLegalMoves(s))
                    if (m.FromRow == best.FromRow && m.FromCol == best.FromCol &&
                        m.ToRow == best.ToRow && m.ToCol == best.ToCol) isLegal = true;
            Check("AI 深度 3 返回合法走法", isLegal);
            long ms = sw.ElapsedMilliseconds;
            Check("AI 深度 3 中局搜索 < 2 秒", ms < 2000);
        }

        // ---------- 22. 角格车被吃后撤销易位权 ----------
        private static void TestCastlingRightRevokedOnRookCapture()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[7, 4] = 'K'; s.Board[7, 7] = 'R';
            s.Board[0, 7] = 'r'; s.Board[0, 4] = 'k';
            s.WhiteToMove = false;
            s.CanCastleWK = s.CanCastleWQ = s.CanCastleBK = s.CanCastleBQ = true;

            Move? move = null;
            foreach (Move m in Rules.GenerateLegalMoves(s, 0, 7))
                if (m.ToRow == 7 && m.ToCol == 7) move = m;
            Check("黑车可走到 h1 吃掉白车", move != null);
            GameState after = s.Clone();
            Rules.ApplyMove(after, move!);
            Check("角格白车被吃后白方失去短易位权", !after.CanCastleWK);
            Check("黑车已占领 h1", after.Board[7, 7] == 'r');
        }

        // ---------- 23. 退化局面 ----------
        private static void TestDegeneratePositions()
        {
            GameState empty = new GameState(); EmptyBoard(empty);
            Check("空盘 a1 不被攻击", !Rules.IsAttacked(empty.Board, 7, 0, true) && !Rules.IsAttacked(empty.Board, 7, 0, false));
            Check("空盘 e4 不被攻击", !Rules.IsAttacked(empty.Board, 4, 4, true) && !Rules.IsAttacked(empty.Board, 4, 4, false));

            GameState kk = new GameState(); EmptyBoard(kk);
            kk.Board[7, 4] = 'K'; kk.Board[0, 4] = 'k';
            Move? bm = AIEngine.FindBestMove(kk, 1);
            Check("K vs K 局面 FindBestMove 有值（王可走）", bm != null);

            GameState mate = new GameState();
            mate = Play(mate, 6, 4, 4, 4); mate = Play(mate, 1, 4, 3, 4);
            mate = Play(mate, 7, 5, 4, 2); mate = Play(mate, 0, 1, 2, 2);
            mate = Play(mate, 7, 3, 3, 7); mate = Play(mate, 0, 6, 2, 5);
            mate = Play(mate, 3, 7, 1, 5); // Qxf7#
            Move? mateMove = AIEngine.FindBestMove(mate, 1);
            Check("将死局面 FindBestMove = Nothing", mateMove == null);
        }

        // ---------- 24. 升变 SAN 记谱 ----------
        private static void TestPromotionSAN()
        {
            GameState s = new GameState(); EmptyBoard(s);
            s.Board[1, 4] = 'P'; s.Board[7, 4] = 'K'; s.Board[0, 7] = 'k';
            Move? qmove = null;
            foreach (Move m in Rules.GenerateLegalMoves(s, 1, 4))
                if (m.Special == SpecialMove.Promotion && m.Promotion == 'Q') qmove = m;
            Check("升后走法存在", qmove != null);
            if (qmove != null)
            {
                Check("升变 SAN 含 =Q", qmove.ToString().IndexOf("=Q", StringComparison.Ordinal) >= 0);
                Check("升变 SAN = e8=Q", qmove.ToString() == "e8=Q");
            }
        }

        // 运行全部测试，返回失败数（0 = 全绿）
        public static int RunTests()
        {
            TestInitialPosition();
            TestIsAttackedBasics();
            TestPawnDoubleAndEnPassant();
            TestCastling();
            TestPromotion();
            TestScholarMate();
            TestFoolMate();
            TestStalemate();
            TestInsufficientMaterial();
            TestFiftyMoveCounter();
            TestThreefoldRepetition();
            TestEvaluation();
            TestNegamaxTerminalScores();
            TestAIFindsMate();
            TestAICapturesFreeQueen();
            TestAIChooseReasonableOpening();
            TestPinnedPiece();
            TestCheckEvasion();
            TestEnPassantRevealCheck();
            TestInsufficientMaterialExtended();
            TestDepth3Timing();
            TestCastlingRightRevokedOnRookCapture();
            TestDegeneratePositions();
            TestPromotionSAN();
            TestPerft();

            Console.WriteLine();
            Console.WriteLine("========================================");
            Console.WriteLine("RESULT: " + g_pass + " passed, " + g_fail + " failed");
            Console.WriteLine("========================================");
            return g_fail;
        }
    }
}
