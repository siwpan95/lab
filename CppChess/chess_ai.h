// =============================================================================
// chess_ai.h — AI 对弈引擎（C++17，对齐 VB 版 ChessAI.vb）
// -----------------------------------------------------------------------------
// 架构（参考轻量国际象棋引擎通用方案）：
//   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
//   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
//   3. 终局评分：将死 ±900000（越快将死分越高）、逼和/子力不足 = 0
//
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// 性能：搜索路径使用 GameState.CloneLight() + ApplyMove(recordHistory=false)
// =============================================================================

#ifndef CHESS_AI_H
#define CHESS_AI_H

#include "chess_core.h"
#include <optional>

class AIEngine {
public:
    static constexpr int MateScore = 900000;   // 将死基准分
    static constexpr int Infinity = 1000000;   // 有界无穷大

    // 局面评估（白方视角：正 = 白方占优）
    static int Evaluate(const GameState& state);

    // 主搜索：negamax + alpha-beta
    static int Negamax(const GameState& state, int depth, int alpha, int beta, int ply);

    // 对外接口：求最佳走法（无合法走法时为 nullopt）
    static std::optional<Move> FindBestMove(const GameState& state, int depth);

    // 静态搜索（quiescence）
    static int Quiescence(const GameState& state, int alpha, int beta, int qdepth);

private:
    static int PieceIndex(char p);
    static int MoveOrderScore(const Move& m);
    static void OrderMoves(std::vector<Move>& moves);
    static int GetPST(int pieceIdx, int pos); // 返回白方视角 PST 值
};

#endif // CHESS_AI_H
