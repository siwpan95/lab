// =============================================================================
// main.cpp — C++ 国际象棋入口（C++17）
// -----------------------------------------------------------------------------
// 子命令：
//   cppchess                运行 97 项自测（默认）
//   cppchess test          运行 97 项自测
//   cppchess selfplay N D  AI(白) vs AI(黑) 各走 N 步，搜索深度 D，演示对弈推进
//   cppchess bench D       从初始局面做 FindBestMove 计时（深度 D）
//   cppchess play [ai]     文本交互对弈；加 ai 则人类执白、AI(黑) 接手
// =============================================================================

#include "chess_core.h"
#include "chess_ai.h"
#include "tests.h"
#include <iostream>
#include <string>
#include <chrono>
#include <cstdlib>

// 渲染棋盘（字母简记 + 坐标），供文本界面与自对弈演示
static void PrintBoard(const GameState& s) {
    std::cout << "  +------------------------+\n";
    for (int r = 0; r < 8; ++r) {
        std::cout << (8 - r) << " | ";
        for (int c = 0; c < 8; ++c) {
            char p = s.board[r][c];
            std::cout << (p == '.' ? '.' : p) << ' ';
        }
        std::cout << "|\n";
    }
    std::cout << "  +------------------------+\n";
    std::cout << "    a b c d e f g h\n";
}

// 解析 "e2e4" 形式的坐标串（返回是否成功 + from/to）
static bool ParseSquare(const std::string& sq, int& row, int& col) {
    if (sq.size() != 2) return false;
    if (sq[0] < 'a' || sq[0] > 'h') return false;
    if (sq[1] < '1' || sq[1] > '8') return false;
    col = sq[0] - 'a';
    row = 8 - (sq[1] - '0');
    return true;
}

int cmd_tests() {
    int fails = runTests();
    return fails == 0 ? 0 : 1;
}

int cmd_selfplay(int nmoves, int depth) {
    GameState s;
    std::cout << "=== AI vs AI 自对弈（深度 " << depth << "，各 " << nmoves << " 步） ===\n";
    for (int i = 0; i < nmoves; ++i) {
        std::vector<Move> all = Rules::GenerateAllLegalMoves(s);
        if (all.empty()) {
            std::cout << "对局结束：";
            if (Rules::IsInCheck(s, s.whiteToMove)) std::cout << (s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
            else std::cout << "逼和/和棋";
            std::cout << "\n";
            PrintBoard(s);
            return 0;
        }
        auto best = AIEngine::FindBestMove(s, depth);
        if (!best) { std::cout << "无最佳走法（异常）\n"; return 1; }
        Rules::ApplyMove(s, *best);
        std::cout << (s.whiteToMove ? "黑" : "白") << ": " << best->toString() << "\n";
    }
    PrintBoard(s);
    std::cout << "半步计数: " << s.halfmoveClock << "  走子历史条数: " << s.history.size() << "\n";
    return 0;
}

int cmd_bench(int depth) {
    GameState s;
    auto t0 = std::chrono::high_resolution_clock::now();
    auto best = AIEngine::FindBestMove(s, depth);
    auto t1 = std::chrono::high_resolution_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    if (best)
        std::cout << "深度 " << depth << " 建议走法: " << best->toString()
                  << "  (" << ms << " ms)\n";
    else
        std::cout << "无走法\n";
    return 0;
}

// 交互对弈
int cmd_play(bool vsAI) {
    GameState s;
    int depth = 2;
    std::cout << "文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。\n";
    PrintBoard(s);
    while (true) {
        // 终局检测
        if (Rules::GenerateAllLegalMoves(s).empty()) {
            std::cout << "对局结束：";
            if (Rules::IsInCheck(s, s.whiteToMove)) std::cout << (s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
            else std::cout << "逼和/和棋";
            std::cout << "\n";
            break;
        }
        bool aiTurn = vsAI && ((s.whiteToMove && false) || (!s.whiteToMove)); // 人类执白，AI 执黑
        if (aiTurn) {
            auto best = AIEngine::FindBestMove(s, depth);
            if (!best) { std::cout << "AI 无走法\n"; break; }
            Rules::ApplyMove(s, *best);
            std::cout << "AI(黑): " << best->toString() << "\n";
            PrintBoard(s);
            continue;
        }

        std::string line;
        std::cout << (s.whiteToMove ? "白方" : "黑方") << "走子> ";
        if (!std::getline(std::cin, line)) break;
        if (line == "quit" || line == "exit") break;
        if (line == "new") { s.ResetToStartPosition(); PrintBoard(s); continue; }

        // 解析 from to
        std::string from, to;
        if (line.size() >= 4) { from = line.substr(0, 2); to = line.substr(2, 2); }
        else { std::cout << "格式错误（示例 e2e4）\n"; continue; }

        int fr, fc, tr, tc;
        if (!ParseSquare(from, fr, fc) || !ParseSquare(to, tr, tc)) {
            std::cout << "坐标非法\n"; continue;
        }
        // 查找匹配走法（升变默认选后）
        std::optional<Move> chosen;
        for (const auto& m : Rules::GenerateLegalMoves(s, fr, fc)) {
            if (m.toRow == tr && m.toCol == tc) {
                if (m.special == SpecialMove::Promotion && m.promotion != 'Q') continue;
                chosen = m;
            }
        }
        if (!chosen) { std::cout << "非法走法\n"; continue; }
        Rules::ApplyMove(s, *chosen);
        PrintBoard(s);
        if (Rules::IsInCheck(s, s.whiteToMove))
            std::cout << "将军！\n";
    }
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 2) {
        std::string cmd = argv[1];
        if (cmd == "test") return cmd_tests();
        if (cmd == "selfplay") {
            int n = (argc >= 3) ? std::atoi(argv[2]) : 8;
            int d = (argc >= 4) ? std::atoi(argv[3]) : 2;
            return cmd_selfplay(n, d);
        }
        if (cmd == "bench") {
            int d = (argc >= 3) ? std::atoi(argv[2]) : 3;
            return cmd_bench(d);
        }
        if (cmd == "play") {
            bool ai = (argc >= 3 && std::string(argv[2]) == "ai");
            return cmd_play(ai);
        }
        std::cout << "未知子命令: " << cmd << "\n";
        std::cout << "可用: test | selfplay [N] [D] | bench [D] | play [ai]\n";
        return 1;
    }
    // 默认运行自测
    return cmd_tests();
}
