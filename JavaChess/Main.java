// =============================================================================
// Main.java — Java 国际象棋入口（Java 17，对齐 CppChess/main.cpp）
// -----------------------------------------------------------------------------
// 子命令：
//   java Main                运行全部自测（默认）
//   java Main test           运行全部自测
//   java Main selfplay N D  AI(白) vs AI(黑) 各走 N 步，搜索深度 D，演示对弈推进
//   java Main bench D        从初始局面做 FindBestMove 计时（深度 D）
//   java Main play [ai]      文本交互对弈；加 ai 则人类执白、AI(黑) 接手
//
// 零第三方依赖，仅用 JDK 标准库。
// =============================================================================

import java.util.List;
import java.util.Scanner;

public class Main {

    // 渲染棋盘（字母简记 + 坐标）
    static void PrintBoard(GameState s) {
        System.out.println("  +------------------------+");
        for (int r = 0; r < 8; ++r) {
            System.out.print((8 - r) + " | ");
            for (int c = 0; c < 8; ++c) {
                char p = s.board[r][c];
                System.out.print((p == '.') ? ". " : (p + " "));
            }
            System.out.println("|");
        }
        System.out.println("  +------------------------+");
        System.out.println("    a b c d e f g h");
    }

    // 解析 "e2e4" 形式的坐标串（返回是否成功 + from/to）
    static boolean ParseSquare(String sq, int[] rc) {
        if (sq.length() != 2) return false;
        if (sq.charAt(0) < 'a' || sq.charAt(0) > 'h') return false;
        if (sq.charAt(1) < '1' || sq.charAt(1) > '8') return false;
        rc[1] = sq.charAt(0) - 'a';
        rc[0] = 8 - (sq.charAt(1) - '0');
        return true;
    }

    static int cmd_tests() {
        int fails = Tests.runTests();
        return fails == 0 ? 0 : 1;
    }

    static int cmd_selfplay(int nmoves, int depth) {
        GameState s = new GameState();
        System.out.println("=== AI vs AI 自对弈（深度 " + depth + "，各 " + nmoves + " 步） ===");
        for (int i = 0; i < nmoves; ++i) {
            List<Move> all = Rules.GenerateAllLegalMoves(s);
            if (all.isEmpty()) {
                System.out.print("对局结束：");
                if (Rules.IsInCheck(s, s.whiteToMove)) System.out.print(s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
                else System.out.print("逼和/和棋");
                System.out.println();
                PrintBoard(s);
                return 0;
            }
            Move best = AIEngine.FindBestMove(s, depth);
            if (best == null) { System.out.println("无最佳走法（异常）"); return 1; }
            Rules.ApplyMove(s, best);
            System.out.println((s.whiteToMove ? "黑" : "白") + ": " + best.toString());
        }
        PrintBoard(s);
        System.out.println("半步计数: " + s.halfmoveClock + "  走子历史条数: " + s.history.size());
        return 0;
    }

    static int cmd_bench(int depth) {
        GameState s = new GameState();
        long t0 = System.nanoTime();
        Move best = AIEngine.FindBestMove(s, depth);
        long t1 = System.nanoTime();
        long ms = (t1 - t0) / 1_000_000;
        if (best != null)
            System.out.println("深度 " + depth + " 建议走法: " + best.toString() + "  (" + ms + " ms)");
        else
            System.out.println("无走法");
        return 0;
    }

    // 交互对弈
    static int cmd_play(boolean vsAI) {
        GameState s = new GameState();
        int depth = 2;
        System.out.println("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。");
        PrintBoard(s);
        Scanner sc = new Scanner(System.in);
        while (true) {
            // 终局检测
            if (Rules.GenerateAllLegalMoves(s).isEmpty()) {
                System.out.print("对局结束：");
                if (Rules.IsInCheck(s, s.whiteToMove)) System.out.print(s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
                else System.out.print("逼和/和棋");
                System.out.println();
                break;
            }
            boolean aiTurn = vsAI && !s.whiteToMove; // 人类执白，AI 执黑
            if (aiTurn) {
                Move best = AIEngine.FindBestMove(s, depth);
                if (best == null) { System.out.println("AI 无走法"); break; }
                Rules.ApplyMove(s, best);
                System.out.println("AI(黑): " + best.toString());
                PrintBoard(s);
                continue;
            }

            System.out.print((s.whiteToMove ? "白方" : "黑方") + "走子> ");
            String line;
            if (!sc.hasNextLine()) break;
            line = sc.nextLine().trim();
            if (line.equals("quit") || line.equals("exit")) break;
            if (line.equals("new")) { s.ResetToStartPosition(); PrintBoard(s); continue; }

            // 解析 from to
            String from, to;
            if (line.length() >= 4) { from = line.substring(0, 2); to = line.substring(2, 2 + 2); }
            else { System.out.println("格式错误（示例 e2e4）"); continue; }

            int[] fr = new int[2], fc = new int[2];
            if (!ParseSquare(from, fr) || !ParseSquare(to, fc)) {
                System.out.println("坐标非法"); continue;
            }
            // 查找匹配走法（升变默认选后）
            Move chosen = null;
            for (Move m : Rules.GenerateLegalMoves(s, fr[0], fr[1])) {
                if (m.toRow == fc[0] && m.toCol == fc[1]) {
                    if (m.special == SpecialMove.Promotion && m.promotion != 'Q') continue;
                    chosen = m;
                }
            }
            if (chosen == null) { System.out.println("非法走法"); continue; }
            Rules.ApplyMove(s, chosen);
            PrintBoard(s);
            if (Rules.IsInCheck(s, s.whiteToMove))
                System.out.println("将军！");
        }
        sc.close();
        return 0;
    }

    public static void main(String[] args) {
        if (args.length >= 1) {
            String cmd = args[0];
            if (cmd.equals("test")) { System.exit(cmd_tests()); return; }
            if (cmd.equals("selfplay")) {
                int n = (args.length >= 2) ? Integer.parseInt(args[1]) : 8;
                int d = (args.length >= 3) ? Integer.parseInt(args[2]) : 2;
                System.exit(cmd_selfplay(n, d)); return;
            }
            if (cmd.equals("bench")) {
                int d = (args.length >= 2) ? Integer.parseInt(args[1]) : 3;
                System.exit(cmd_bench(d)); return;
            }
            if (cmd.equals("play")) {
                boolean ai = (args.length >= 2 && args[1].equals("ai"));
                System.exit(cmd_play(ai)); return;
            }
            System.out.println("未知子命令: " + cmd);
            System.out.println("可用: test | selfplay [N] [D] | bench [D] | play [ai]");
            System.exit(1); return;
        }
        // 默认运行自测
        System.exit(cmd_tests());
    }
}
