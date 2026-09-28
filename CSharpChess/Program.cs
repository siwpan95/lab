// =============================================================================
// Program.cs — C# 国际象棋入口（对齐 C++ 参考 main.cpp）
// -----------------------------------------------------------------------------
// 用法（子命令）：
//   ChessEngine                运行 97 项自测（默认）
//   ChessEngine test           运行 97 项自测
//   ChessEngine selfplay N D   AI(白) vs AI(黑) 各走 N 步，搜索深度 D（默认 N=8 D=2）
//   ChessEngine bench D        从初始局面做 FindBestMove 计时（默认 D=3）
//   ChessEngine play [ai]      文本交互对弈；加 ai 则人类执白、AI(黑) 接手（深度 2）
//
// 构建：dotnet build（零第三方依赖，仅 .NET 标准库）
// 退出码：test 全绿 = 0，存在失败 = 1（与 C++ main.cpp 一致）
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;

namespace ChessEngine
{
    public static class Program
    {
        // 渲染棋盘（字母简记 + 坐标），供文本界面与自对弈演示
        private static void PrintBoard(GameState s)
        {
            Console.WriteLine("  +------------------------+");
            for (int r = 0; r < 8; ++r)
            {
                StringBuilder line = new StringBuilder();
                line.Append(8 - r);
                line.Append(" | ");
                for (int c = 0; c < 8; ++c)
                {
                    char p = s.Board[r, c];
                    line.Append(p == '.' ? '.' : p);
                    line.Append(' ');
                }
                line.Append('|');
                Console.WriteLine(line.ToString());
            }
            Console.WriteLine("  +------------------------+");
            Console.WriteLine("    a b c d e f g h");
        }

        // 解析 "e2" 形式的坐标串（返回是否成功 + row/col）
        private static bool ParseSquare(string sq, out int row, out int col)
        {
            row = 0; col = 0;
            if (sq.Length != 2) return false;
            if (sq[0] < 'a' || sq[0] > 'h') return false;
            if (sq[1] < '1' || sq[1] > '8') return false;
            col = sq[0] - 'a';
            row = 8 - (sq[1] - '0');
            return true;
        }

        // 与 C 的 atoi 行为一致：无法解析时返回 0
        private static int Atoi(string s)
        {
            int v;
            return int.TryParse(s, out v) ? v : 0;
        }

        private static int CmdTests()
        {
            int fails = Tests.RunTests();
            return fails == 0 ? 0 : 1;
        }

        private static int CmdSelfplay(int nmoves, int depth)
        {
            GameState s = new GameState();
            Console.WriteLine("=== AI vs AI 自对弈（深度 " + depth + "，各 " + nmoves + " 步） ===");
            for (int i = 0; i < nmoves; ++i)
            {
                List<Move> all = Rules.GenerateAllLegalMoves(s);
                if (all.Count == 0)
                {
                    string reason;
                    if (Rules.IsInCheck(s, s.WhiteToMove)) reason = s.WhiteToMove ? "黑方将死白方" : "白方将死黑方";
                    else reason = "逼和/和棋";
                    Console.WriteLine("对局结束：" + reason);
                    PrintBoard(s);
                    return 0;
                }
                Move? best = AIEngine.FindBestMove(s, depth);
                if (best == null) { Console.WriteLine("无最佳走法（异常）"); return 1; }
                Rules.ApplyMove(s, best);
                Console.WriteLine((s.WhiteToMove ? "黑" : "白") + ": " + best.ToString());
            }
            PrintBoard(s);
            Console.WriteLine("半步计数: " + s.HalfmoveClock + "  走子历史条数: " + s.History.Count);
            return 0;
        }

        private static int CmdBench(int depth)
        {
            GameState s = new GameState();
            Stopwatch sw = Stopwatch.StartNew();
            Move? best = AIEngine.FindBestMove(s, depth);
            sw.Stop();
            long ms = sw.ElapsedMilliseconds;
            if (best != null)
                Console.WriteLine("深度 " + depth + " 建议走法: " + best.ToString() + "  (" + ms + " ms)");
            else
                Console.WriteLine("无走法");
            return 0;
        }

        // 交互对弈
        private static int CmdPlay(bool vsAI)
        {
            GameState s = new GameState();
            int depth = 2;
            Console.WriteLine("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。");
            PrintBoard(s);
            while (true)
            {
                // 终局检测
                if (Rules.GenerateAllLegalMoves(s).Count == 0)
                {
                    string reason;
                    if (Rules.IsInCheck(s, s.WhiteToMove)) reason = s.WhiteToMove ? "黑方将死白方" : "白方将死黑方";
                    else reason = "逼和/和棋";
                    Console.WriteLine("对局结束：" + reason);
                    break;
                }
                bool aiTurn = vsAI && !s.WhiteToMove; // 人类执白，AI 执黑
                if (aiTurn)
                {
                    Move? aiBest = AIEngine.FindBestMove(s, depth);
                    if (aiBest == null) { Console.WriteLine("AI 无走法"); break; }
                    Rules.ApplyMove(s, aiBest);
                    Console.WriteLine("AI(黑): " + aiBest.ToString());
                    PrintBoard(s);
                    continue;
                }

                Console.Write((s.WhiteToMove ? "白方" : "黑方") + "走子> ");
                string? line = Console.ReadLine();
                if (line == null) break;
                if (line == "quit" || line == "exit") break;
                if (line == "new") { s.ResetToStartPosition(); PrintBoard(s); continue; }

                // 解析 from to
                string from, to;
                if (line.Length >= 4) { from = line.Substring(0, 2); to = line.Substring(2, 2); }
                else { Console.WriteLine("格式错误（示例 e2e4）"); continue; }

                int fr, fc, tr, tc;
                if (!ParseSquare(from, out fr, out fc) || !ParseSquare(to, out tr, out tc))
                {
                    Console.WriteLine("坐标非法"); continue;
                }
                // 查找匹配走法（升变默认选后）
                Move? chosen = null;
                foreach (Move m in Rules.GenerateLegalMoves(s, fr, fc))
                {
                    if (m.ToRow == tr && m.ToCol == tc)
                    {
                        if (m.Special == SpecialMove.Promotion && m.Promotion != 'Q') continue;
                        chosen = m;
                    }
                }
                if (chosen == null) { Console.WriteLine("非法走法"); continue; }
                Rules.ApplyMove(s, chosen);
                PrintBoard(s);
                if (Rules.IsInCheck(s, s.WhiteToMove))
                    Console.WriteLine("将军！");
            }
            return 0;
        }

        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;

            if (args.Length >= 1)
            {
                string cmd = args[0];
                if (cmd == "test") return CmdTests();
                if (cmd == "selfplay")
                {
                    int n = (args.Length >= 2) ? Atoi(args[1]) : 8;
                    int d = (args.Length >= 3) ? Atoi(args[2]) : 2;
                    return CmdSelfplay(n, d);
                }
                if (cmd == "bench")
                {
                    int d = (args.Length >= 2) ? Atoi(args[1]) : 3;
                    return CmdBench(d);
                }
                if (cmd == "play")
                {
                    bool ai = (args.Length >= 2 && args[1] == "ai");
                    return CmdPlay(ai);
                }
                Console.WriteLine("未知子命令: " + cmd);
                Console.WriteLine("可用: test | selfplay [N] [D] | bench [D] | play [ai]");
                return 1;
            }
            // 默认运行自测
            return CmdTests();
        }
    }
}
