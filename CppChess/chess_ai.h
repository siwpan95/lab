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
#include <string>

// ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
// 与 JsChess/chessAI.js 的 EVAL_PROFILE / Go 版 EvalProfileSpec 同构：每引擎一份独立
// profile，术语全部是白黑严格镜像差值（初始对称局面评估仍为 0）。字段顺序与
// ProfileHash 的规范化串即契约，验收门 tournament/validate_eval_profile.mjs 用同一
// djb2-32 算法独立重算比对。本引擎档位 = pawnstructure。
struct EvalProfile {
    static constexpr const char* name = "pawnstructure";
    static constexpr int pawnShieldMissing  = 12; // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
    static constexpr int pawnShieldOpenFile = 8;  // 王自家线在王前方已无任何己方兵
    static constexpr int doubledPawn        = 22; // 每个叠兵（同线多出的每一个）
    static constexpr int isolatedPawn       = 25; // 每个孤兵（相邻线无己方兵）
    static constexpr int passedPawnBase     = 25; // 通路兵基础分
    static constexpr int passedPawnPerRank  = 10; // 通路兵每向升变推进一行的加成
    static constexpr int bishopPair         = 25; // 双象
    static constexpr int mobilityWeight     = 0;  // 预留：机动性每步权重（试点关闭）
};

class AIEngine {
public:
    static constexpr int MateScore = 900000;   // 将死基准分
    static constexpr int Infinity = 1000000;   // 有界无穷大
    // RepetitionPenalty：叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过的局面）
    // 中时，按出现次数扣分（白方视角）。引导搜索远离重复局面，减少三重复和棋。约半兵，足以
    // 影响平手选择又不至于为避重而弃子。
    static constexpr int REPETITION_PENALTY = 60;

    // 局面评估（白方视角：正 = 白方占优）
    static int Evaluate(const GameState& state);

    // Tier 2-C 风格术语（白黑镜像差值）：兵形 / 王安全 / 双象
    static int PawnStructureScore(const GameState& state);
    static int KingSafetyScore(const GameState& state);
    static int BishopPairScore(const GameState& state);

    // 本引擎评估档名与 djb2-32 哈希（规范化串 "name|w1|...|w8"）
    static const char* ProfileName() { return EvalProfile::name; }
    static std::string ProfileHash();

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
