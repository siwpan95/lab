// =============================================================================
// chess_ai.cpp — AI 对弈引擎实现（C++17，对齐 VB 版 ChessAI.vb）
// =============================================================================

#include "chess_ai.h"
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>

// ---------------------------- 子力价值（厘兵单位） ----------------------------
// 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
static const int PieceValue[7] = {0, 100, 320, 330, 500, 900, 0};

// ---------------------------- 位置价值表 PST（白方视角） ----------------------------
static const int PST_Pawn[64] = {
    0,  0,  0,  0,  0,  0,  0,  0,
   50, 50, 50, 50, 50, 50, 50, 50,
   10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
};
static const int PST_Knight[64] = {
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
};
static const int PST_Bishop[64] = {
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
};
static const int PST_Rook[64] = {
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
};
static const int PST_Queen[64] = {
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
};
static const int PST_King[64] = {
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
int AIEngine::PieceIndex(char p) {
    switch (std::toupper(static_cast<unsigned char>(p))) {
        case 'P': return 1;
        case 'N': return 2;
        case 'B': return 3;
        case 'R': return 4;
        case 'Q': return 5;
        case 'K': return 6;
        default:  return 0;
    }
}

int AIEngine::GetPST(int pieceIdx, int pos) {
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
int AIEngine::Evaluate(const GameState& state) {
    int score = 0;
    const char (&b)[8][8] = state.board;
    for (int r = 0; r < 8; ++r) {
        for (int c = 0; c < 8; ++c) {
            char p = b[r][c];
            if (p == '.') continue;
            int idx = PieceIndex(p);
            int pos = r * 8 + c;
            if (std::isupper(static_cast<unsigned char>(p))) {
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
    if (state.RepHistory != nullptr) {
        std::string key = state.PositionKeySimple();
        auto it = state.RepHistory->find(key);
        if (it != state.RepHistory->end() && it->second > 0) {
            score -= REPETITION_PENALTY * it->second;
        }
    }
    return score;
}

// ---------------------------- 评估档哈希（Tier 2-C） ----------------------------
// ProfileHash：profile 规范化串的 djb2-32，与 JS 侧 evalProfileHash / Go 侧 ProfileHash
// 逐字节同算法。规范化串 "pawnstructure|12|8|22|25|25|10|25|0"（整数无空格），
// h=5381 起（uint32_t），逐字节 h=h*33+(uint8_t)b 自然回绕，输出 8 位小写 hex。
std::string AIEngine::ProfileHash() {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%s|%d|%d|%d|%d|%d|%d|%d|%d",
                  EvalProfile::name, EvalProfile::pawnShieldMissing,
                  EvalProfile::pawnShieldOpenFile, EvalProfile::doubledPawn,
                  EvalProfile::isolatedPawn, EvalProfile::passedPawnBase,
                  EvalProfile::passedPawnPerRank, EvalProfile::bishopPair,
                  EvalProfile::mobilityWeight);
    uint32_t h = 5381;
    for (const char* p = buf; *p != '\0'; ++p)
        h = h * 33 + static_cast<uint8_t>(*p);
    char out[16];
    std::snprintf(out, sizeof(out), "%08x", h);
    return std::string(out);
}

// ---------------------------- Tier 2-C 风格术语（白黑镜像差值） ----------------------------

// 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
int AIEngine::PawnStructureScore(const GameState& state) {
    const char (&b)[8][8] = state.board;
    int wCnt[8] = {0}, bCnt[8] = {0};
    int wPawns[64][2], bPawns[64][2];
    int wN = 0, bN = 0;
    for (int r = 0; r < 8; ++r) {
        for (int c = 0; c < 8; ++c) {
            if (b[r][c] == 'P') { wCnt[c]++; wPawns[wN][0] = r; wPawns[wN][1] = c; ++wN; }
            else if (b[r][c] == 'p') { bCnt[c]++; bPawns[bN][0] = r; bPawns[bN][1] = c; ++bN; }
        }
    }
    int score = 0;
    for (int c = 0; c < 8; ++c) {
        if (wCnt[c] > 1) score -= EvalProfile::doubledPawn * (wCnt[c] - 1);
        if (bCnt[c] > 1) score += EvalProfile::doubledPawn * (bCnt[c] - 1);
    }
    for (int i = 0; i < wN; ++i) {
        int r = wPawns[i][0], c = wPawns[i][1];
        bool isolated = (c == 0 || wCnt[c - 1] == 0) && (c == 7 || wCnt[c + 1] == 0);
        if (isolated) score -= EvalProfile::isolatedPawn;
        bool passed = true;
        for (int f = c - 1; f <= c + 1 && passed; ++f) {
            if (f < 0 || f > 7) continue;
            for (int rr = r - 1; rr >= 0; --rr)
                if (b[rr][f] == 'p') { passed = false; break; }
        }
        if (passed) score += EvalProfile::passedPawnBase + EvalProfile::passedPawnPerRank * (6 - r);
    }
    for (int i = 0; i < bN; ++i) {
        int r = bPawns[i][0], c = bPawns[i][1];
        bool isolated = (c == 0 || bCnt[c - 1] == 0) && (c == 7 || bCnt[c + 1] == 0);
        if (isolated) score += EvalProfile::isolatedPawn;
        bool passed = true;
        for (int f = c - 1; f <= c + 1 && passed; ++f) {
            if (f < 0 || f > 7) continue;
            for (int rr = r + 1; rr <= 7; ++rr)
                if (b[rr][f] == 'P') { passed = false; break; }
        }
        if (passed) score -= EvalProfile::passedPawnBase + EvalProfile::passedPawnPerRank * (r - 1);
    }
    return score;
}

// 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
int AIEngine::KingSafetyScore(const GameState& state) {
    const char (&b)[8][8] = state.board;
    int wkR = -1, wkC = -1, bkR = -1, bkC = -1;
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c) {
            if (b[r][c] == 'K') { wkR = r; wkC = c; }
            else if (b[r][c] == 'k') { bkR = r; bkC = c; }
        }
    if (wkR < 0 || bkR < 0) return 0;
    int score = 0;
    if (wkR >= 6) {
        for (int c = (wkC > 0 ? wkC - 1 : 0); c <= (wkC < 7 ? wkC + 1 : 7); ++c)
            if (b[wkR - 1][c] != 'P') score -= EvalProfile::pawnShieldMissing;
        bool shielded = false;
        for (int r = wkR - 1; r >= 0; --r)
            if (b[r][wkC] == 'P') { shielded = true; break; }
        if (!shielded) score -= EvalProfile::pawnShieldOpenFile;
    }
    if (bkR <= 1) {
        for (int c = (bkC > 0 ? bkC - 1 : 0); c <= (bkC < 7 ? bkC + 1 : 7); ++c)
            if (b[bkR + 1][c] != 'p') score += EvalProfile::pawnShieldMissing;
        bool shielded = false;
        for (int r = bkR + 1; r <= 7; ++r)
            if (b[r][bkC] == 'p') { shielded = true; break; }
        if (!shielded) score += EvalProfile::pawnShieldOpenFile;
    }
    return score;
}

// 双象分（白方视角差值）。
int AIEngine::BishopPairScore(const GameState& state) {
    const char (&b)[8][8] = state.board;
    int wb = 0, bb = 0;
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c) {
            if (b[r][c] == 'B') ++wb;
            else if (b[r][c] == 'b') ++bb;
        }
    int score = 0;
    if (wb >= 2) score += EvalProfile::bishopPair;
    if (bb >= 2) score -= EvalProfile::bishopPair;
    return score;
}

// 当前行棋方视角分数（negamax 约定）
static int EvaluateSide(const GameState& state) {
    int s = AIEngine::Evaluate(state);
    return state.whiteToMove ? s : -s;
}

// ---------------------------- 走法排序（MVV-LVA） ----------------------------
int AIEngine::MoveOrderScore(const Move& m) {
    if (m.captured == '.') return 0;
    int victim = PieceValue[PieceIndex(m.captured)];
    int attacker = PieceValue[PieceIndex(m.piece)];
    return victim * 10 - attacker;
}

void AIEngine::OrderMoves(std::vector<Move>& moves) {
    std::sort(moves.begin(), moves.end(),
              [](const Move& a, const Move& b) {
                  return MoveOrderScore(a) > MoveOrderScore(b);
              });
}

// ---------------------------- Tier 2-B 时间控制 ----------------------------
// 软阈值只决定是否开启下一轮；硬阈值在搜索中每 2048 个节点检查一次。
namespace {
constexpr std::uint64_t NodesPerTimeCheck = 2048;
constexpr std::int64_t SoftNumerator = 1;
constexpr std::int64_t SoftDenominator = 2;

struct SearchClock {
    using Clock = std::chrono::steady_clock;

    explicit SearchClock(int timeMs)
        : limitMs(timeMs),
          start(Clock::now()),
          softDeadline(start + std::chrono::milliseconds(
              static_cast<std::int64_t>(timeMs) * SoftNumerator / SoftDenominator)) {}

    bool Tick() {
        ++nodes;
        if (nodes % NodesPerTimeCheck == 0 &&
            Clock::now() - start >= std::chrono::milliseconds(limitMs)) {
            aborted = true;
        }
        return aborted;
    }

    bool OverSoft() const {
        return Clock::now() >= softDeadline;
    }

    std::int64_t limitMs;
    Clock::time_point start;
    Clock::time_point softDeadline;
    std::uint64_t nodes = 0;
    bool aborted = false;
};

SearchClock* searchClock = nullptr;

bool ClockTick() {
    return searchClock != nullptr && searchClock->Tick();
}

bool ClockOverSoft() {
    return searchClock != nullptr && searchClock->OverSoft();
}
} // namespace

// ---------------------------- 静态搜索（quiescence） ----------------------------
int AIEngine::Quiescence(const GameState& state, int alpha, int beta, int qdepth) {
    if (ClockTick()) return alpha;

    int stand = EvaluateSide(state);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth >= 4) return alpha;

    std::vector<Move> captures;
    for (const Move& m : Rules::GenerateAllLegalMoves(state))
        if (m.captured != '.') captures.push_back(m);
    OrderMoves(captures);

    for (const Move& m : captures) {
        GameState child = state.CloneLight();
        Rules::ApplyMove(child, m, false);
        int score = -Quiescence(child, -beta, -alpha, qdepth + 1);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

// ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
int AIEngine::Negamax(const GameState& state, int depth, int alpha, int beta, int ply) {
    if (ClockTick()) return alpha;

    std::vector<Move> moves = Rules::GenerateAllLegalMoves(state);

    if (moves.empty()) {
        if (Rules::IsInCheck(state, state.whiteToMove))
            return -MateScore + ply; // 被将死：离根越近越差
        return 0; // 逼和
    }

    if (depth <= 0)
        return Quiescence(state, alpha, beta, 0);

    OrderMoves(moves);

    int best = -Infinity;
    for (const Move& m : moves) {
        GameState child = state.CloneLight();
        Rules::ApplyMove(child, m, false);
        int score = -Negamax(child, depth - 1, -beta, -alpha, ply + 1);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // β 剪枝
    }
    return best;
}

// ---------------------------- 对外接口：求最佳走法 ----------------------------

// 根结点一轮搜索（给定深度）。moves 按值传入，保证迭代加深每轮从相同顺序开始。
Move AIEngine::SearchRoot(const GameState& state, std::vector<Move> moves, int depth) {
    OrderMoves(moves);

    Move bestMove = moves[0];
    int bestScore = -Infinity;
    int alpha = -Infinity;
    const int beta = Infinity;

    for (const Move& m : moves) {
        GameState child = state.CloneLight();
        Rules::ApplyMove(child, m, false);
        int score = -Negamax(child, depth - 1, -beta, -alpha, 1);
        if (searchClock != nullptr && searchClock->aborted) break;
        if (score > bestScore) {
            bestScore = score;
            bestMove = m;
        }
        if (score > alpha) alpha = score;
    }
    return bestMove;
}

std::optional<Move> AIEngine::FindBestMoveTimed(const GameState& state, int depth, int timeMs) {
    std::vector<Move> moves = Rules::GenerateAllLegalMoves(state);
    if (moves.empty()) return std::nullopt;
    if (moves.size() == 1) return moves[0];

    const int cap = depth > 0 ? depth : 3;
    if (timeMs <= 0 || cap <= 1) {
        // timeMs <= 0 时严格沿用调用方传入的 depth，保持改造前的固定深度行为。
        const int fixedDepth = timeMs <= 0 ? depth : cap;
        SearchClock* previousClock = searchClock;
        searchClock = nullptr;
        Move bestMove = SearchRoot(state, moves, fixedDepth);
        searchClock = previousClock;
        return bestMove;
    }

    SearchClock clock(timeMs);
    searchClock = &clock;
    Move bestMove = moves[0];
    bool completed = false;
    for (int d = 1; d <= cap; ++d) {
        if (completed && ClockOverSoft()) break;
        clock.aborted = false;
        Move move = SearchRoot(state, moves, d);
        if (clock.aborted && completed) break;
        bestMove = move;
        completed = true;
    }
    searchClock = nullptr;
    return bestMove;
}

std::optional<Move> AIEngine::FindBestMove(const GameState& state, int depth) {
    return FindBestMoveTimed(state, depth, 0);
}
