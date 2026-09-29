// =============================================================================
// chess_ai.cpp — AI 对弈引擎实现（C++17，对齐 VB 版 ChessAI.vb）
// =============================================================================

#include "chess_ai.h"
#include <algorithm>

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

// ---------------------------- 静态搜索（quiescence） ----------------------------
int AIEngine::Quiescence(const GameState& state, int alpha, int beta, int qdepth) {
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
std::optional<Move> AIEngine::FindBestMove(const GameState& state, int depth) {
    std::vector<Move> moves = Rules::GenerateAllLegalMoves(state);
    if (moves.empty()) return std::nullopt;
    if (moves.size() == 1) return moves[0];

    OrderMoves(moves);

    Move bestMove = moves[0];
    int bestScore = -Infinity;
    int alpha = -Infinity;
    int beta = Infinity;

    for (const Move& m : moves) {
        GameState child = state.CloneLight();
        Rules::ApplyMove(child, m, false);
        int score = -Negamax(child, depth - 1, -beta, -alpha, 1);
        if (score > bestScore) {
            bestScore = score;
            bestMove = m;
        }
        if (score > alpha) alpha = score;
    }
    return bestMove;
}
