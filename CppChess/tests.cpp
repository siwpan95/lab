// =============================================================================
// tests.cpp — 核心规则自测（C++17，对齐 VB 版 ChessTests.vb 的 97 项断言）
// 覆盖：初始走法数 / 过路兵 / 王车易位 / 升变 / 将死（学者杀、愚兄杀）/
//       逼和 / 子力不足 / 50 步计数 / IsAttacked 基础语义 / 钉死 / 逃将 /
//       EP 揭开将军 / 子力不足扩展 / 深度3计时 / 角格车被吃撤销易位权 /
//       退化局面 / 升变 SAN
// =============================================================================

#include "chess_core.h"
#include "chess_ai.h"
#include "tests.h"
#include <iostream>
#include <chrono>
#include <optional>
#include <stdexcept>

namespace {

int g_pass = 0, g_fail = 0;

void Check(const std::string& name, bool cond) {
    if (cond) {
        ++g_pass;
        std::cout << "[PASS] " << name << "\n";
    } else {
        ++g_fail;
        std::cout << "[FAIL] " << name << "\n";
    }
}

// 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
Move FindMove(const GameState& state, int r, int c, int tr, int tc) {
    for (const Move& m : Rules::GenerateLegalMoves(state, r, c))
        if (m.toRow == tr && m.toCol == tc) return m;
    throw std::runtime_error("move not found");
}

// 走一步并返回新状态（深拷贝 + 应用）
GameState Play(const GameState& state, int r, int c, int tr, int tc) {
    Move m = FindMove(state, r, c, tr, tc);
    GameState s = state.Clone();
    Rules::ApplyMove(s, m);
    return s;
}

// 清空棋盘上所有棋子（测试用）
void EmptyBoard(GameState& s) {
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c)
            s.board[r][c] = '.';
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = false;
    s.enPassantRow = s.enPassantCol = -1;
    s.halfmoveClock = 0; s.fullmoveNumber = 1;
    s.history.clear(); s.positionKeys.clear();
    s.positionKeys.push_back(s.GetPositionKey());
}

// ---------- 1. 初始局面 ----------
void TestInitialPosition() {
    GameState s;
    Check("初始局面白方合法走法数 = 20", Rules::GenerateAllLegalMoves(s).size() == 20);
    Check("初始局面 b1 马走法数 = 2", Rules::GenerateLegalMoves(s, 7, 1).size() == 2);
    Check("初始局面 g1 马走法数 = 2", Rules::GenerateLegalMoves(s, 7, 6).size() == 2);
    Check("初始局面 e2 兵走法数 = 2", Rules::GenerateLegalMoves(s, 6, 4).size() == 2);
    Check("初始局面 d1 后走法数 = 0", Rules::GenerateLegalMoves(s, 7, 3).size() == 0);
    Check("初始局面白王不被将军", !Rules::IsInCheck(s, true));
    Check("初始局面黑王不被将军", !Rules::IsInCheck(s, false));
    Check("初始局面非将死", !Rules::IsCheckmate(s));

    GameState b;
    b.whiteToMove = false;
    Check("初始局面黑方合法走法数 = 20", Rules::GenerateAllLegalMoves(b).size() == 20);
}

// ---------- 2. IsAttacked 基础语义 ----------
void TestIsAttackedBasics() {
    GameState s; EmptyBoard(s);
    s.board[4][4] = 'P'; // 白兵 e4
    s.board[3][4] = 'p'; // 黑兵 e5
    s.board[7][4] = 'K'; // 白王 e1
    s.board[0][4] = 'k'; // 黑王 e8

    Check("白兵 e4 攻击 d5", Rules::IsAttacked(s.board, 3, 3, true));
    Check("白兵 e4 攻击 f5", Rules::IsAttacked(s.board, 3, 5, true));
    Check("白兵 e4 不攻击 e5（兵不直吃）", !Rules::IsAttacked(s.board, 3, 4, true));
    Check("黑兵 e5 攻击 d4", Rules::IsAttacked(s.board, 4, 3, false));
    Check("黑兵 e5 攻击 f4", Rules::IsAttacked(s.board, 4, 5, false));
    Check("a1 格不被任何方攻击", !Rules::IsAttacked(s.board, 7, 0, true) && !Rules::IsAttacked(s.board, 7, 0, false));
    Check("白王 e1 攻击 e2", Rules::IsAttacked(s.board, 6, 4, true));
}

// ---------- 3. 双进兵与吃过路兵 ----------
void TestPawnDoubleAndEnPassant() {
    GameState s;
    s = Play(s, 6, 4, 4, 4); // 1. e2-e4
    Check("e4 双进兵设置过路兵格 (5,4)", s.enPassantRow == 5 && s.enPassantCol == 4);
    Check("双进兵后半步计数 = 0", s.halfmoveClock == 0);
    Check("e4 后轮黑方", !s.whiteToMove);

    GameState t; EmptyBoard(t);
    t.board[3][4] = 'P'; // 白兵 e5
    t.board[1][3] = 'p'; // 黑兵 d7（将双走进 d5）
    t.whiteToMove = false;
    t = Play(t, 1, 3, 3, 3); // 黑 d7-d5 → ep 目标 d6 (2,3)
    Check("黑 d5 双进后轮白方", t.whiteToMove);

    std::vector<Move> pawnMoves = Rules::GenerateLegalMoves(t, 3, 4);
    bool hasEP = false;
    for (const auto& m : pawnMoves) if (m.special == SpecialMove::EnPassant) hasEP = true;
    Check("白 e5 兵存在吃过路兵走法", hasEP);

    Move epMove;
    for (const auto& m : pawnMoves) if (m.special == SpecialMove::EnPassant) { epMove = m; break; }
    GameState after = t.Clone();
    Rules::ApplyMove(after, epMove);
    Check("过路兵吃后白兵位于 d6", after.board[2][3] == 'P');
    Check("过路兵吃后黑 d5 兵被移除", after.board[3][3] == '.');
    Check("过路兵吃后过路兵格已清空", after.enPassantRow == -1);
}

// ---------- 4. 王车易位 ----------
void TestCastling() {
    GameState s; EmptyBoard(s);
    s.board[7][4] = 'K'; s.board[7][7] = 'R'; s.board[7][0] = 'R';
    s.board[0][4] = 'k';
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = true;

    std::vector<Move> kingMoves = Rules::GenerateLegalMoves(s, 7, 4);
    bool castleK = false, castleQ = false;
    for (const auto& m : kingMoves) {
        if (m.special == SpecialMove::CastleKingside) castleK = true;
        if (m.special == SpecialMove::CastleQueenside) castleQ = true;
    }
    Check("白王可短易位", castleK);
    Check("白王可长易位", castleQ);

    Move mv;
    for (const auto& m : Rules::GenerateLegalMoves(s, 7, 4))
        if (m.special == SpecialMove::CastleKingside) { mv = m; break; }
    GameState after = s.Clone();
    Rules::ApplyMove(after, mv);
    Check("短易位后白王位于 g1", after.board[7][6] == 'K');
    Check("短易位后白车位于 f1", after.board[7][5] == 'R');
    Check("短易位后 h1 为空", after.board[7][7] == '.');
    Check("短易位后白方失去全部易位权", !after.canCastleWK && !after.canCastleWQ);

    GameState blocked = s.Clone();
    blocked.board[3][3] = 'r'; // 黑车 d5，攻击 d1
    std::vector<Move> km = Rules::GenerateLegalMoves(blocked, 7, 4);
    bool castleQBlocked = false;
    for (const auto& m : km) if (m.special == SpecialMove::CastleQueenside) castleQBlocked = true;
    Check("路径 d1 被攻击时长易位被禁止", !castleQBlocked);

    GameState inCheck = s.Clone();
    inCheck.board[3][4] = 'r'; // 黑车 e5 攻击 e1
    km = Rules::GenerateLegalMoves(inCheck, 7, 4);
    bool anyCastle = false;
    for (const auto& m : km)
        if (m.special == SpecialMove::CastleKingside || m.special == SpecialMove::CastleQueenside) anyCastle = true;
    Check("王被将军时禁止易位", !anyCastle);
}

// ---------- 5. 兵升变 ----------
void TestPromotion() {
    GameState s; EmptyBoard(s);
    s.board[1][4] = 'P'; s.board[7][4] = 'K'; s.board[0][7] = 'k';

    std::vector<Move> moves = Rules::GenerateLegalMoves(s, 1, 4);
    int promoCount = 0;
    for (const auto& m : moves) if (m.special == SpecialMove::Promotion) ++promoCount;
    Check("e7 兵生成 4 种升变走法（Q/R/B/N）", promoCount == 4);

    Move mv;
    for (const auto& m : Rules::GenerateLegalMoves(s, 1, 4))
        if (m.special == SpecialMove::Promotion && m.promotion == 'Q') { mv = m; break; }
    GameState after = s.Clone();
    Rules::ApplyMove(after, mv);
    Check("升变后 e8 为白后", after.board[0][4] == 'Q');
    Check("升变后 e7 为空", after.board[1][4] == '.');
}

// ---------- 6. 学者将杀 ----------
void TestScholarMate() {
    GameState s;
    s = Play(s, 6, 4, 4, 4); // 1. e4
    s = Play(s, 1, 4, 3, 4); // 1... e5
    s = Play(s, 7, 5, 4, 2); // 2. Bf1-c4
    s = Play(s, 0, 1, 2, 2); // 2... Nb8-c6
    s = Play(s, 7, 3, 3, 7); // 3. Qd1-h5
    s = Play(s, 0, 6, 2, 5); // 3... Ng8-f6
    s = Play(s, 3, 7, 1, 5); // 4. Qh5xf7#

    Check("学者将杀：黑方被将军", Rules::IsInCheck(s, false));
    Check("学者将杀：IsCheckmate = True", Rules::IsCheckmate(s));
    Check("学者将杀：非逼和", !Rules::IsStalemate(s));
    Check("学者将杀后轮黑方", !s.whiteToMove);
}

// ---------- 7. 愚兄杀 ----------
void TestFoolMate() {
    GameState s;
    s = Play(s, 6, 5, 5, 5); // 1. f3
    s = Play(s, 1, 4, 3, 4); // 1... e5
    s = Play(s, 6, 6, 4, 6); // 2. g4
    s = Play(s, 0, 3, 4, 7); // 2... Qd8-h4#

    Check("愚兄杀：白方被将军", Rules::IsInCheck(s, true));
    Check("愚兄杀：IsCheckmate = True", Rules::IsCheckmate(s));
}

// ---------- 8. 逼和 ----------
void TestStalemate() {
    GameState s; EmptyBoard(s);
    s.board[0][7] = 'k'; s.board[1][5] = 'Q'; s.board[2][6] = 'K';
    s.whiteToMove = false;

    Check("逼和局面：黑方不被将军", !Rules::IsInCheck(s, false));
    Check("逼和局面：黑方合法走法数 = 0", Rules::GenerateAllLegalMoves(s).size() == 0);
    Check("逼和局面：IsStalemate = True", Rules::IsStalemate(s));
    Check("逼和局面：非将死", !Rules::IsCheckmate(s));
}

// ---------- 9. 子力不足 ----------
void TestInsufficientMaterial() {
    GameState kk; EmptyBoard(kk);
    kk.board[7][4] = 'K'; kk.board[0][4] = 'k';
    Check("仅剩双王 = 子力不足", Rules::IsInsufficientMaterial(kk));

    kk.board[4][4] = 'N';
    Check("王+单马 vs 王 = 子力不足", Rules::IsInsufficientMaterial(kk));

    kk.board[4][4] = 'b';
    Check("王+单象 vs 王 = 子力不足", Rules::IsInsufficientMaterial(kk));

    kk.board[4][4] = 'P';
    Check("王+兵 vs 王 ≠ 子力不足", !Rules::IsInsufficientMaterial(kk));

    kk.board[4][4] = 'R';
    Check("王+车 vs 王 ≠ 子力不足", !Rules::IsInsufficientMaterial(kk));

    GameState full;
    Check("初始局面 ≠ 子力不足", !Rules::IsInsufficientMaterial(full));
}

// ---------- 10. 50 步规则计数 ----------
void TestFiftyMoveCounter() {
    GameState s;
    s = Play(s, 7, 6, 5, 5); // 1. Ng1-f3
    Check("马走一步后半步计数 = 1", s.halfmoveClock == 1);
    s = Play(s, 0, 6, 2, 5); // 1... Ng8-f6
    Check("两步非兵非吃后半步计数 = 2", s.halfmoveClock == 2);
    s = Play(s, 5, 5, 7, 6); // 2. Nf3-g1
    Check("三步后半步计数 = 3", s.halfmoveClock == 3);
    s = Play(s, 2, 5, 0, 6); // 2... Nf6-g8
    Check("四步后半步计数 = 4", s.halfmoveClock == 4);
    s = Play(s, 6, 4, 4, 4); // 3. e4（动兵清零）
    Check("动兵后半步计数清零", s.halfmoveClock == 0);
    Check("未达 100 半步不判 50 步和棋", !Rules::IsFiftyMoveDraw(s));

    GameState forced; forced.halfmoveClock = 100;
    Check("100 半步判 50 步和棋", Rules::IsFiftyMoveDraw(forced));
}

// ---------- 11. 三次重复局面判和 ----------
void TestThreefoldRepetition() {
    GameState s;
    s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 6, 2, 5);
    s = Play(s, 5, 5, 7, 6); s = Play(s, 2, 5, 0, 6);
    Check("4 步往返后局面重复第 2 次（不判和）", !Rules::IsThreefoldRepetition(s));

    s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 6, 2, 5);
    s = Play(s, 5, 5, 7, 6); s = Play(s, 2, 5, 0, 6);
    Check("8 步往返后局面重复第 3 次（判和）", Rules::IsThreefoldRepetition(s));

    s = Play(s, 6, 4, 4, 4);
    Check("走出新局面后不再判和", !Rules::IsThreefoldRepetition(s));
}

// ---------- 12. 评估函数 ----------
void TestEvaluation() {
    GameState s;
    Check("初始局面评估 = 0（对称）", AIEngine::Evaluate(s) == 0);
    s.board[4][4] = 'P';
    int score1 = AIEngine::Evaluate(s);
    Check("白方多一兵 → 评估为正", score1 > 0);
    s.board[3][3] = 'n';
    int score2 = AIEngine::Evaluate(s);
    Check("黑方多一马压过白方一兵 → 评估为负", score2 < 0);
}

// ---------- 13. Negamax 终局评分 ----------
void TestNegamaxTerminalScores() {
    GameState s;
    s = Play(s, 6, 4, 4, 4); s = Play(s, 1, 4, 3, 4);
    s = Play(s, 7, 5, 4, 2); s = Play(s, 0, 1, 2, 2);
    s = Play(s, 7, 3, 3, 7); s = Play(s, 0, 6, 2, 5);
    s = Play(s, 3, 7, 1, 5); // 4. Qxf7#
    int mateScore = AIEngine::Negamax(s, 2, -AIEngine::Infinity, AIEngine::Infinity, 0);
    Check("将死局面 negamax 返回大负数", mateScore <= -9000);

    GameState st; EmptyBoard(st);
    st.board[0][7] = 'k'; st.board[1][5] = 'Q'; st.board[2][6] = 'K';
    st.whiteToMove = false;
    st.positionKeys.clear(); st.positionKeys.push_back(st.GetPositionKey());
    int staleScore = AIEngine::Negamax(st, 2, -AIEngine::Infinity, AIEngine::Infinity, 0);
    Check("逼和局面 negamax 返回 0", staleScore == 0);
}

// ---------- 14. AI 一步杀 ----------
void TestAIFindsMate() {
    GameState s; EmptyBoard(s);
    s.board[2][1] = 'K'; s.board[7][7] = 'Q'; s.board[0][0] = 'k';
    s.whiteToMove = true;
    s.positionKeys.clear(); s.positionKeys.push_back(s.GetPositionKey());

    auto best = AIEngine::FindBestMove(s, 2);
    GameState after = s.Clone();
    Rules::ApplyMove(after, *best);
    Check("AI 深度 2 找到一步杀（Qh8#）", Rules::IsCheckmate(after));
}

// ---------- 15. AI 白吃无保护后 ----------
void TestAICapturesFreeQueen() {
    GameState s; EmptyBoard(s);
    s.board[7][3] = 'Q'; s.board[7][4] = 'K'; s.board[0][3] = 'q'; s.board[0][7] = 'k';
    s.whiteToMove = true;
    s.positionKeys.clear(); s.positionKeys.push_back(s.GetPositionKey());

    auto best = AIEngine::FindBestMove(s, 2);
    Check("AI 深度 2 捕获无保护黑后",
          best && best->toRow == 0 && best->toCol == 3 && best->captured == 'q');
}

// ---------- 16. AI 开局合理性 ----------
void TestAIChooseReasonableOpening() {
    GameState s;
    auto t0 = std::chrono::high_resolution_clock::now();
    auto best = AIEngine::FindBestMove(s, 2);
    auto t1 = std::chrono::high_resolution_clock::now();
    bool isLegal = false;
    if (best) {
        for (const auto& m : Rules::GenerateAllLegalMoves(s))
            if (m.fromRow == best->fromRow && m.fromCol == best->fromCol &&
                m.toRow == best->toRow && m.toCol == best->toCol) isLegal = true;
    }
    Check("初始局面 AI 返回合法走法", isLegal);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    Check("AI 深度 2 初始局面搜索 < 5 秒", ms < 5000);
}

// ---------- 17. 被钉死棋子限制 ----------
void TestPinnedPiece() {
    GameState s; EmptyBoard(s);
    s.board[7][3] = 'K'; s.board[6][3] = 'B'; s.board[0][3] = 'r'; s.board[0][4] = 'k';
    Check("钉死前象存在伪合法走法", !Rules::GeneratePseudoMoves(s, 6, 3).empty());
    Check("被钉死象无合法走法", Rules::GenerateLegalMoves(s, 6, 3).empty());
    Check("钉死局面白王未被将军", !Rules::IsInCheck(s, true));
}

// ---------- 18. 被将军时合法走法枚举 ----------
void TestCheckEvasion() {
    GameState s; EmptyBoard(s);
    s.board[7][4] = 'K'; s.board[0][4] = 'r'; s.board[0][0] = 'k';
    Check("逃将局面白王被将军", Rules::IsInCheck(s, true));
    std::vector<Move> legal = Rules::GenerateAllLegalMoves(s);
    Check("被将军时合法走法均为逃着（>0）", !legal.empty());
    bool allResolve = true;
    for (const auto& m : legal) {
        GameState after = s.Clone();
        Rules::ApplyMove(after, m);
        if (Rules::IsInCheck(after, true)) allResolve = false;
    }
    Check("每个合法走法均解除将军", allResolve);
}

// ---------- 19. 过路兵吃子揭开己方王 ----------
void TestEnPassantRevealCheck() {
    GameState s; EmptyBoard(s);
    s.board[3][0] = 'K'; s.board[3][7] = 'r'; s.board[3][3] = 'P'; s.board[3][4] = 'p';
    s.whiteToMove = true;
    s.enPassantRow = 2; s.enPassantCol = 4;
    s.positionKeys.clear();
    Check("EP 揭开将军：当前白王未被将军", !Rules::IsInCheck(s, true));
    std::vector<Move> legal = Rules::GenerateLegalMoves(s, 3, 3);
    bool hasEP = false;
    for (const auto& m : legal) if (m.special == SpecialMove::EnPassant) hasEP = true;
    Check("EP 吃子会揭开己方王 → 不出现在合法走法中", !hasEP);
}

// ---------- 20. 子力不足扩展 ----------
void TestInsufficientMaterialExtended() {
    GameState s; EmptyBoard(s);
    s.board[7][4] = 'K'; s.board[0][4] = 'k';
    Check("KK = 子力不足", Rules::IsInsufficientMaterial(s));
    s.board[7][1] = 'N';
    Check("KN vs K = 子力不足", Rules::IsInsufficientMaterial(s));
    s.board[7][2] = 'N';
    Check("KNN vs K = 子力不足", Rules::IsInsufficientMaterial(s));

    GameState kb; EmptyBoard(kb);
    kb.board[7][4] = 'K'; kb.board[0][4] = 'k';
    kb.board[7][2] = 'B'; kb.board[0][3] = 'b';
    Check("KB vs KB = 子力不足", Rules::IsInsufficientMaterial(kb));

    GameState kbb; EmptyBoard(kbb);
    kbb.board[7][4] = 'K'; kbb.board[0][4] = 'k';
    kbb.board[7][2] = 'B'; kbb.board[7][5] = 'B';
    Check("KBB 异色格双象可杀 ≠ 子力不足", !Rules::IsInsufficientMaterial(kbb));

    GameState kbn; EmptyBoard(kbn);
    kbn.board[7][4] = 'K'; kbn.board[0][4] = 'k';
    kbn.board[7][2] = 'B'; kbn.board[7][1] = 'N';
    Check("KBN vs K 可杀 ≠ 子力不足", !Rules::IsInsufficientMaterial(kbn));

    GameState kr; EmptyBoard(kr);
    kr.board[7][4] = 'K'; kr.board[0][4] = 'k'; kr.board[7][0] = 'R';
    Check("K + 车 vs K 可杀 ≠ 子力不足", !Rules::IsInsufficientMaterial(kr));
}

// ---------- 21. AI 深度 3 性能 ----------
void TestDepth3Timing() {
    GameState s;
    s = Play(s, 6, 4, 4, 4); s = Play(s, 1, 4, 3, 4);
    s = Play(s, 7, 6, 5, 5); s = Play(s, 0, 1, 2, 2);
    s = Play(s, 7, 5, 4, 2); s = Play(s, 0, 6, 2, 5);
    auto t0 = std::chrono::high_resolution_clock::now();
    auto best = AIEngine::FindBestMove(s, 3);
    auto t1 = std::chrono::high_resolution_clock::now();
    bool isLegal = false;
    if (best)
        for (const auto& m : Rules::GenerateAllLegalMoves(s))
            if (m.fromRow == best->fromRow && m.fromCol == best->fromCol &&
                m.toRow == best->toRow && m.toCol == best->toCol) isLegal = true;
    Check("AI 深度 3 返回合法走法", isLegal);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    Check("AI 深度 3 中局搜索 < 2 秒", ms < 2000);
}

// ---------- 22. 角格车被吃后撤销易位权 ----------
void TestCastlingRightRevokedOnRookCapture() {
    GameState s; EmptyBoard(s);
    s.board[7][4] = 'K'; s.board[7][7] = 'R';
    s.board[0][7] = 'r'; s.board[0][4] = 'k';
    s.whiteToMove = false;
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = true;

    std::optional<Move> move;
    for (const auto& m : Rules::GenerateLegalMoves(s, 0, 7))
        if (m.toRow == 7 && m.toCol == 7) move = m;
    Check("黑车可走到 h1 吃掉白车", move.has_value());
    GameState after = s.Clone();
    Rules::ApplyMove(after, *move);
    Check("角格白车被吃后白方失去短易位权", !after.canCastleWK);
    Check("黑车已占领 h1", after.board[7][7] == 'r');
}

// ---------- 23. 退化局面 ----------
void TestDegeneratePositions() {
    GameState empty; EmptyBoard(empty);
    Check("空盘 a1 不被攻击", !Rules::IsAttacked(empty.board, 7, 0, true) && !Rules::IsAttacked(empty.board, 7, 0, false));
    Check("空盘 e4 不被攻击", !Rules::IsAttacked(empty.board, 4, 4, true) && !Rules::IsAttacked(empty.board, 4, 4, false));

    GameState kk; EmptyBoard(kk);
    kk.board[7][4] = 'K'; kk.board[0][4] = 'k';
    auto bm = AIEngine::FindBestMove(kk, 1);
    Check("K vs K 局面 FindBestMove 有值（王可走）", bm.has_value());

    GameState mate;
    mate = Play(mate, 6, 4, 4, 4); mate = Play(mate, 1, 4, 3, 4);
    mate = Play(mate, 7, 5, 4, 2); mate = Play(mate, 0, 1, 2, 2);
    mate = Play(mate, 7, 3, 3, 7); mate = Play(mate, 0, 6, 2, 5);
    mate = Play(mate, 3, 7, 1, 5); // Qxf7#
    auto mateMove = AIEngine::FindBestMove(mate, 1);
    Check("将死局面 FindBestMove = Nothing", !mateMove.has_value());
}

// ---------- 24. 升变 SAN 记谱 ----------
void TestPromotionSAN() {
    GameState s; EmptyBoard(s);
    s.board[1][4] = 'P'; s.board[7][4] = 'K'; s.board[0][7] = 'k';
    std::optional<Move> qmove;
    for (const auto& m : Rules::GenerateLegalMoves(s, 1, 4))
        if (m.special == SpecialMove::Promotion && m.promotion == 'Q') qmove = m;
    Check("升后走法存在", qmove.has_value());
    if (qmove) {
        Check("升变 SAN 含 =Q", qmove->toString().find("=Q") != std::string::npos);
        Check("升变 SAN = e8=Q", qmove->toString() == "e8=Q");
    }
}

// ---------- 25. Perft (move-gen node-count) golden values ----------
// 由 8 条 rank 串（rank 8 在前）+ 行棋方 + 易位串 构建局面。
// 字母 => 对应棋子字符；数字 N => N 个 '.' 空格。
GameState BuildPosition(const std::string ranks[8], bool whiteToMove, const std::string& castling) {
    GameState s;
    for (int r = 0; r < 8; ++r) {
        const std::string& rank = ranks[r];   // ranks[0] = row 0 = 第 8 横线
        int col = 0;
        for (char ch : rank) {
            if (ch >= '1' && ch <= '8') {
                int n = ch - '0';
                for (int k = 0; k < n; ++k) s.board[r][col++] = '.';
            } else {
                s.board[r][col++] = ch;
            }
        }
    }
    s.whiteToMove = whiteToMove;
    s.canCastleWK = castling.find('K') != std::string::npos;
    s.canCastleWQ = castling.find('Q') != std::string::npos;
    s.canCastleBK = castling.find('k') != std::string::npos;
    s.canCastleBQ = castling.find('q') != std::string::npos;
    s.enPassantRow = -1;
    s.enPassantCol = -1;
    s.halfmoveClock = 0;
    s.fullmoveNumber = 1;
    s.history.clear();
    s.positionKeys.clear();
    s.positionKeys.push_back(s.GetPositionKey());
    return s;
}

// perft：标准节点计数（与现有测试一致的 Clone + 2 参 ApplyMove）
long long perft(const GameState& state, int depth) {
    if (depth == 0) return 1;
    const auto moves = Rules::GenerateAllLegalMoves(state);
    if (depth == 1) return static_cast<long long>(moves.size());
    long long count = 0;
    for (const auto& m : moves) {
        GameState child = state.Clone();   // 完整克隆，等同现有测试
        Rules::ApplyMove(child, m);        // 等同现有测试的 2 参 ApplyMove
        count += perft(child, depth - 1);
    }
    return count;
}

void TestPerft() {
    // Pos1 初始局面
    {
        const std::string ranks[8] = {
            "rnbqkbnr","pppppppp","........","........",
            "........","........","PPPPPPPP","RNBQKBNR"};
        GameState s = BuildPosition(ranks, true, "KQkq");
        Check("Perft Start d1 = 20",     perft(s, 1) == 20);
        Check("Perft Start d2 = 400",    perft(s, 2) == 400);
        Check("Perft Start d3 = 8902",   perft(s, 3) == 8902);
        Check("Perft Start d4 = 197281", perft(s, 4) == 197281);
    }
    // Pos2 Kiwipete
    {
        const std::string ranks[8] = {
            "r3k2r","p1ppqpb1","bn2pnp1","3PN3",
            "1p2P3","2N2Q1p","PPPBBPPP","R3K2R"};
        GameState s = BuildPosition(ranks, true, "KQkq");
        Check("Perft Kiwipete d1 = 48",   perft(s, 1) == 48);
        Check("Perft Kiwipete d2 = 2039", perft(s, 2) == 2039);
        Check("Perft Kiwipete d3 = 97862",perft(s, 3) == 97862);
        // d4 == 4085603 （>2M 节点，较慢，作为参考不自动运行）
    }
    // Pos3 Wiki3  (canonical perft position 3: 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1)
    {
        const std::string ranks[8] = {
            "8","2p5","3p4","KP5r",
            "1R3p1k","8","4P1P1","8"};
        GameState s = BuildPosition(ranks, true, "");
        Check("Perft Pos3 d1 = 14",    perft(s, 1) == 14);
        Check("Perft Pos3 d2 = 191",   perft(s, 2) == 191);
        Check("Perft Pos3 d3 = 2812",  perft(s, 3) == 2812);
        Check("Perft Pos3 d4 = 43238", perft(s, 4) == 43238);
    }
    // Pos4 Wiki5
    {
        const std::string ranks[8] = {
            "rnbq1k1r","pp1Pbppp","2p5","8",
            "2B5","8","PPP1NnPP","RNBQK2R"};
        GameState s = BuildPosition(ranks, true, "KQ");
        Check("Perft Pos5 d1 = 44",   perft(s, 1) == 44);
        Check("Perft Pos5 d2 = 1486", perft(s, 2) == 1486);
        Check("Perft Pos5 d3 = 62379",perft(s, 3) == 62379);
        // d4 == 2103487 （>2M 节点，较慢，作为参考不自动运行）
    }
}

} // namespace

// 运行全部测试，返回失败数（0 = 全绿）
int runTests() {
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

    std::cout << "\n========================================\n";
    std::cout << "RESULT: " << g_pass << " passed, " << g_fail << " failed\n";
    std::cout << "========================================\n";
    return g_fail;
}
