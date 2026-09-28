// =============================================================================
// chess_core.cpp — 规则引擎实现（C++17，对齐 VB 版 ChessCore.vb）
// =============================================================================

#include "chess_core.h"
#include <cstring>
#include <cctype>
#include <algorithm>

// ---------------------------- Move 记谱 ----------------------------
std::string Move::toString() const {
    if (special == SpecialMove::CastleKingside) return "O-O";
    if (special == SpecialMove::CastleQueenside) return "O-O-O";
    const char* files = "abcdefgh";
    std::string fromSq = std::string() + files[fromCol] + static_cast<char>('0' + (8 - fromRow));
    std::string toSq   = std::string() + files[toCol] + static_cast<char>('0' + (8 - toRow));
    if (piece == 'P' || piece == 'p') {
        std::string s;
        if (isCapture()) s += files[fromCol]; // 兵吃子记来源文件
        s += toSq;
        if (special == SpecialMove::Promotion) {
            s += '=';
            s += static_cast<char>(toupper(promotion));
        }
        return s;
    } else {
        std::string s;
        s += static_cast<char>(toupper(piece));
        s += fromSq;
        if (isCapture()) s += 'x';
        s += toSq;
        return s;
    }
}

// ---------------------------- GameState ----------------------------
void GameState::ResetToStartPosition() {
    static const char back[] = "rnbqkbnr";
    for (int c = 0; c < 8; ++c) {
        board[0][c] = back[c];
        board[1][c] = 'p';
        board[2][c] = '.';
        board[3][c] = '.';
        board[4][c] = '.';
        board[5][c] = '.';
        board[6][c] = 'P';
        board[7][c] = static_cast<char>(toupper(back[c]));
    }
    whiteToMove = true;
    canCastleWK = canCastleWQ = canCastleBK = canCastleBQ = true;
    enPassantRow = enPassantCol = -1;
    halfmoveClock = 0;
    fullmoveNumber = 1;
    history.clear();
    positionKeys.clear();
    positionKeys.push_back(GetPositionKey());
}

std::string GameState::GetPositionKey() const {
    std::string s;
    s.reserve(90);
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c)
            s += board[r][c];
    s += (whiteToMove ? 'w' : 'b');
    s += (canCastleWK ? 'K' : '-');
    s += (canCastleWQ ? 'Q' : '-');
    s += (canCastleBK ? 'k' : '-');
    s += (canCastleBQ ? 'q' : '-');
    if (Rules::HasLegalEnPassant(*this)) {
        s += std::to_string(enPassantRow);
        s += ',';
        s += std::to_string(enPassantCol);
    } else {
        s += "-1,-1";
    }
    return s;
}

GameState GameState::Clone() const {
    GameState s;
    std::memcpy(s.board, board, sizeof(board));
    s.whiteToMove = whiteToMove;
    s.canCastleWK = canCastleWK; s.canCastleWQ = canCastleWQ;
    s.canCastleBK = canCastleBK; s.canCastleBQ = canCastleBQ;
    s.enPassantRow = enPassantRow; s.enPassantCol = enPassantCol;
    s.halfmoveClock = halfmoveClock; s.fullmoveNumber = fullmoveNumber;
    s.history = history;
    s.positionKeys = positionKeys;
    return s;
}

GameState GameState::CloneLight() const {
    GameState s;
    std::memcpy(s.board, board, sizeof(board));
    s.whiteToMove = whiteToMove;
    s.canCastleWK = canCastleWK; s.canCastleWQ = canCastleWQ;
    s.canCastleBK = canCastleBK; s.canCastleBQ = canCastleBQ;
    s.enPassantRow = enPassantRow; s.enPassantCol = enPassantCol;
    s.halfmoveClock = halfmoveClock; s.fullmoveNumber = fullmoveNumber;
    // 轻量克隆：跳过 history 与 positionKeys（AI 搜索不关心记谱/重复判定）
    return s;
}

// ---------------------------- Rules 基础工具 ----------------------------
bool Rules::InBoard(int r, int c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
bool Rules::IsWhitePiece(char p) { return p != '.' && std::isupper(static_cast<unsigned char>(p)); }
bool Rules::IsBlackPiece(char p) { return p != '.' && std::islower(static_cast<unsigned char>(p)); }
bool Rules::IsPieceOfSide(char p, bool white) {
    if (p == '.') return false;
    return white ? std::isupper(static_cast<unsigned char>(p)) : std::islower(static_cast<unsigned char>(p));
}

// ---------------------------- IsAttacked ----------------------------
bool Rules::IsAttacked(const char board[8][8], int r, int c, bool byWhite) {
    // --- 1. 兵攻击（白兵攻击其上方两斜格，黑兵反之） ---
    char pawn = byWhite ? 'P' : 'p';
    int pr = byWhite ? r + 1 : r - 1;
    if (pr >= 0 && pr <= 7) {
        if (c - 1 >= 0 && board[pr][c - 1] == pawn) return true;
        if (c + 1 <= 7 && board[pr][c + 1] == pawn) return true;
    }

    // --- 2. 马攻击（8 个 L 形跳位） ---
    char knight = byWhite ? 'N' : 'n';
    static const int dr2[] = {-2, -2, -1, -1, 1, 1, 2, 2};
    static const int dc2[] = {-1, 1, -2, 2, -2, 2, -1, 1};
    for (int i = 0; i < 8; ++i) {
        int tr = r + dr2[i], tc = c + dc2[i];
        if (InBoard(tr, tc) && board[tr][tc] == knight) return true;
    }

    // --- 3. 王攻击（8 邻格） ---
    char king = byWhite ? 'K' : 'k';
    for (int dr = -1; dr <= 1; ++dr)
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;
            int tr = r + dr, tc = c + dc;
            if (InBoard(tr, tc) && board[tr][tc] == king) return true;
        }

    // --- 4. 滑动射线攻击：直线（车/后）+ 斜线（象/后） ---
    char rook = byWhite ? 'R' : 'r';
    char queen = byWhite ? 'Q' : 'q';
    char bishop = byWhite ? 'B' : 'b';
    static const int dirR[] = {-1, 1, 0, 0, -1, -1, 1, 1};
    static const int dirC[] = {0, 0, -1, 1, -1, 1, -1, 1};
    for (int i = 0; i < 8; ++i) {
        int tr = r + dirR[i], tc = c + dirC[i];
        while (InBoard(tr, tc)) {
            char p = board[tr][tc];
            if (p != '.') {
                if (i < 4) { if (p == rook || p == queen) return true; }
                else       { if (p == bishop || p == queen) return true; }
                break;
            }
            tr += dirR[i]; tc += dirC[i];
        }
    }
    return false;
}

// ---------------------------- 兵走法 ----------------------------
void Rules::GeneratePawnMoves(std::vector<Move>& list, const GameState& state,
                              int r, int c, bool isWhite, char enemyPawn) {
    const char (&b)[8][8] = state.board;
    int dir = isWhite ? -1 : 1;
    int startRow = isWhite ? 6 : 1;

    // 前进一格（目标格须为空）
    if (InBoard(r + dir, c) && b[r + dir][c] == '.') {
        AddPawnMove(list, r, c, r + dir, c, '.', SpecialMove::None, isWhite);
        // 起始位置双重进兵
        if (r == startRow && b[r + 2 * dir][c] == '.') {
            Move m;
            m.fromRow = r; m.fromCol = c; m.toRow = r + 2 * dir; m.toCol = c;
            m.piece = b[r][c]; m.captured = '.'; m.special = SpecialMove::DoublePawn; m.promotion = '.';
            list.push_back(m);
        }
    }

    // 斜吃 / 吃过路兵
    static const int dcs[] = {-1, 1};
    for (int dc : dcs) {
        int tr = r + dir, tc = c + dc;
        if (!InBoard(tr, tc)) continue;
        char target = b[tr][tc];
        if (target != '.' && IsPieceOfSide(target, !isWhite)) {
            AddPawnMove(list, r, c, tr, tc, target, SpecialMove::None, isWhite);
        } else if (tr == state.enPassantRow && tc == state.enPassantCol) {
            AddPawnMove(list, r, c, tr, tc, enemyPawn, SpecialMove::EnPassant, isWhite);
        }
    }
}

void Rules::AddPawnMove(std::vector<Move>& list, int fr, int fc, int tr, int tc,
                        char captured, SpecialMove special, bool isWhite) {
    if (tr == 0 || tr == 7) {
        const char promos[] = "QRBN";
        for (int i = 0; i < 4; ++i) {
            Move m;
            m.fromRow = fr; m.fromCol = fc; m.toRow = tr; m.toCol = tc;
            m.piece = isWhite ? 'P' : 'p';
            m.captured = captured;
            m.special = SpecialMove::Promotion;
            m.promotion = isWhite ? promos[i] : static_cast<char>(tolower(promos[i]));
            list.push_back(m);
        }
    } else {
        Move m;
        m.fromRow = fr; m.fromCol = fc; m.toRow = tr; m.toCol = tc;
        m.piece = isWhite ? 'P' : 'p';
        m.captured = captured;
        m.special = special;
        m.promotion = '.';
        list.push_back(m);
    }
}

// ---------------------------- 马/王固定偏移 ----------------------------
void Rules::GenerateOffsetMoves(std::vector<Move>& list, const char board[8][8],
                                int r, int c, bool isWhite,
                                const int dr[], const int dc[], int n) {
    char p = board[r][c];
    for (int i = 0; i < n; ++i) {
        int tr = r + dr[i], tc = c + dc[i];
        if (!InBoard(tr, tc)) continue;
        char target = board[tr][tc];
        if (target == '.' || IsPieceOfSide(target, !isWhite)) {
            Move m;
            m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
            m.piece = p; m.captured = target; m.special = SpecialMove::None; m.promotion = '.';
            list.push_back(m);
        }
    }
}

// ---------------------------- 象/车/后滑动 ----------------------------
void Rules::GenerateSlidingMoves(std::vector<Move>& list, const char board[8][8],
                                 int r, int c, bool isWhite,
                                 const int dr[], const int dc[], int n) {
    char p = board[r][c];
    for (int i = 0; i < n; ++i) {
        int tr = r + dr[i], tc = c + dc[i];
        while (InBoard(tr, tc)) {
            char target = board[tr][tc];
            if (target == '.') {
                Move m;
                m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
                m.piece = p; m.captured = '.'; m.special = SpecialMove::None; m.promotion = '.';
                list.push_back(m);
            } else {
                if (IsPieceOfSide(target, !isWhite)) {
                    Move m;
                    m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
                    m.piece = p; m.captured = target; m.special = SpecialMove::None; m.promotion = '.';
                    list.push_back(m);
                }
                break;
            }
            tr += dr[i]; tc += dc[i];
        }
    }
}

// ---------------------------- 王车易位 ----------------------------
void Rules::GenerateCastlingMoves(std::vector<Move>& list, const GameState& state,
                                  int r, int c, bool isWhite) {
    const char (&b)[8][8] = state.board;
    if (isWhite) {
        if (r != 7 || c != 4) return;
        // 白方短易位：K e1→g1，R h1→f1
        if (state.canCastleWK && b[7][7] == 'R' && b[7][5] == '.' && b[7][6] == '.') {
            if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 5, false) && !IsAttacked(b, 7, 6, false)) {
                Move m; m.fromRow = 7; m.fromCol = 4; m.toRow = 7; m.toCol = 6;
                m.piece = 'K'; m.captured = '.'; m.special = SpecialMove::CastleKingside; m.promotion = '.';
                list.push_back(m);
            }
        }
        // 白方长易位：K e1→c1，R a1→d1
        if (state.canCastleWQ && b[7][0] == 'R' && b[7][1] == '.' && b[7][2] == '.' && b[7][3] == '.') {
            if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 3, false) && !IsAttacked(b, 7, 2, false)) {
                Move m; m.fromRow = 7; m.fromCol = 4; m.toRow = 7; m.toCol = 2;
                m.piece = 'K'; m.captured = '.'; m.special = SpecialMove::CastleQueenside; m.promotion = '.';
                list.push_back(m);
            }
        }
    } else {
        if (r != 0 || c != 4) return;
        // 黑方短易位：K e8→g8，R h8→f8
        if (state.canCastleBK && b[0][7] == 'r' && b[0][5] == '.' && b[0][6] == '.') {
            if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 5, true) && !IsAttacked(b, 0, 6, true)) {
                Move m; m.fromRow = 0; m.fromCol = 4; m.toRow = 0; m.toCol = 6;
                m.piece = 'k'; m.captured = '.'; m.special = SpecialMove::CastleKingside; m.promotion = '.';
                list.push_back(m);
            }
        }
        // 黑方长易位：K e8→c8，R a8→d8
        if (state.canCastleBQ && b[0][0] == 'r' && b[0][1] == '.' && b[0][2] == '.' && b[0][3] == '.') {
            if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 3, true) && !IsAttacked(b, 0, 2, true)) {
                Move m; m.fromRow = 0; m.fromCol = 4; m.toRow = 0; m.toCol = 2;
                m.piece = 'k'; m.captured = '.'; m.special = SpecialMove::CastleQueenside; m.promotion = '.';
                list.push_back(m);
            }
        }
    }
}

// ---------------------------- 伪合法走法生成入口 ----------------------------
std::vector<Move> Rules::GeneratePseudoMoves(const GameState& state, int r, int c) {
    std::vector<Move> list;
    const char (&b)[8][8] = state.board;
    char p = b[r][c];
    if (p == '.') return list;

    bool isWhite = std::isupper(static_cast<unsigned char>(p));
    char enemyPawn = isWhite ? 'p' : 'P';

    switch (std::toupper(static_cast<unsigned char>(p))) {
        case 'P': GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn); break;
        case 'N': {
            static const int dr[] = {-2, -2, -1, -1, 1, 1, 2, 2};
            static const int dc[] = {-1, 1, -2, 2, -2, 2, -1, 1};
            GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
        } break;
        case 'K': {
            static const int dr[] = {-1, -1, -1, 0, 0, 1, 1, 1};
            static const int dc[] = {-1, 0, 1, -1, 1, -1, 0, 1};
            GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
            GenerateCastlingMoves(list, state, r, c, isWhite);
        } break;
        case 'B': {
            static const int dr[] = {-1, -1, 1, 1};
            static const int dc[] = {-1, 1, -1, 1};
            GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
        } break;
        case 'R': {
            static const int dr[] = {-1, 1, 0, 0};
            static const int dc[] = {0, 0, -1, 1};
            GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
        } break;
        case 'Q': {
            static const int dr[] = {-1, 1, 0, 0, -1, -1, 1, 1};
            static const int dc[] = {0, 0, -1, 1, -1, 1, -1, 1};
            GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 8);
        } break;
    }
    return list;
}

// ---------------------------- 合法走法（两阶段） ----------------------------
std::vector<Move> Rules::GenerateLegalMoves(const GameState& state, int r, int c) {
    std::vector<Move> legal;
    std::vector<Move> pseudo = GeneratePseudoMoves(state, r, c);
    if (pseudo.empty()) return legal;

    bool moverIsWhite = std::isupper(static_cast<unsigned char>(pseudo[0].piece));
    for (const Move& m : pseudo) {
        GameState sim = state.CloneLight();
        ApplyMove(sim, m, false);
        int kr, kc;
        FindKing(sim.board, moverIsWhite, kr, kc);
        if (!IsAttacked(sim.board, kr, kc, !moverIsWhite))
            legal.push_back(m);
    }
    return legal;
}

std::vector<Move> Rules::GenerateAllLegalMoves(const GameState& state) {
    std::vector<Move> all;
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c)
            if (IsPieceOfSide(state.board[r][c], state.whiteToMove))
                for (const Move& m : GenerateLegalMoves(state, r, c))
                    all.push_back(m);
    return all;
}

// ---------------------------- 走子执行 ----------------------------
void Rules::ApplyMove(GameState& state, const Move& m, bool recordHistory) {
    char (&b)[8][8] = state.board;

    // 1. 移动棋子本体
    b[m.toRow][m.toCol] = m.piece;
    b[m.fromRow][m.fromCol] = '.';

    // 2. 特殊走法处理
    switch (m.special) {
        case SpecialMove::DoublePawn:
            state.enPassantRow = (m.fromRow + m.toRow) / 2;
            state.enPassantCol = m.fromCol;
            break;
        case SpecialMove::EnPassant: {
            int capRow = (m.piece == 'P') ? m.toRow + 1 : m.toRow - 1;
            b[capRow][m.toCol] = '.';
        } break;
        case SpecialMove::CastleKingside:
            b[m.fromRow][5] = b[m.fromRow][7];
            b[m.fromRow][7] = '.';
            break;
        case SpecialMove::CastleQueenside:
            b[m.fromRow][3] = b[m.fromRow][0];
            b[m.fromRow][0] = '.';
            break;
        case SpecialMove::Promotion:
            b[m.toRow][m.toCol] = m.promotion;
            break;
        default: break;
    }

    // 3. 非双进兵时清除过路兵目标格
    if (m.special != SpecialMove::DoublePawn) {
        state.enPassantRow = -1;
        state.enPassantCol = -1;
    }

    // 4. 更新易位权
    if (m.piece == 'K') { state.canCastleWK = false; state.canCastleWQ = false; }
    else if (m.piece == 'k') { state.canCastleBK = false; state.canCastleBQ = false; }
    if ((m.fromRow == 7 && m.fromCol == 0) || (m.toRow == 7 && m.toCol == 0)) state.canCastleWQ = false;
    if ((m.fromRow == 7 && m.fromCol == 7) || (m.toRow == 7 && m.toCol == 7)) state.canCastleWK = false;
    if ((m.fromRow == 0 && m.fromCol == 0) || (m.toRow == 0 && m.toCol == 0)) state.canCastleBQ = false;
    if ((m.fromRow == 0 && m.fromCol == 7) || (m.toRow == 0 && m.toCol == 7)) state.canCastleBK = false;

    // 5. 50 步规则计数
    if (std::toupper(static_cast<unsigned char>(m.piece)) == 'P' || m.captured != '.')
        state.halfmoveClock = 0;
    else
        state.halfmoveClock += 1;

    // 6. 回合切换与记谱
    if (!state.whiteToMove) state.fullmoveNumber += 1;
    state.whiteToMove = !state.whiteToMove;
    if (recordHistory) {
        state.history.push_back(m.toString());
        state.positionKeys.push_back(state.GetPositionKey());
    }
}

// ---------------------------- 王定位与将军检测 ----------------------------
void Rules::FindKing(const char board[8][8], bool isWhite, int& r, int& c) {
    char k = isWhite ? 'K' : 'k';
    r = -1; c = -1;
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 8; ++j)
            if (board[i][j] == k) { r = i; c = j; return; }
}

bool Rules::IsInCheck(const GameState& state, bool isWhite) {
    int kr, kc;
    FindKing(state.board, isWhite, kr, kc);
    if (kr < 0) return false;
    return IsAttacked(state.board, kr, kc, !isWhite);
}

// ---------------------------- 终局判定 ----------------------------
bool Rules::IsCheckmate(const GameState& state) {
    return IsInCheck(state, state.whiteToMove) && GenerateAllLegalMoves(state).empty();
}
bool Rules::IsStalemate(const GameState& state) {
    return !IsInCheck(state, state.whiteToMove) && GenerateAllLegalMoves(state).empty();
}
bool Rules::IsFiftyMoveDraw(const GameState& state) {
    return state.halfmoveClock >= 100;
}

bool Rules::HasLegalEnPassant(const GameState& state) {
    if (state.enPassantRow < 0) return false;
    int pawnRank = state.whiteToMove ? state.enPassantRow + 1 : state.enPassantRow - 1;
    if (pawnRank < 0 || pawnRank > 7) return false;
    char pawn = state.whiteToMove ? 'P' : 'p';
    for (int dc = -1; dc <= 1; dc += 2) {
        int c = state.enPassantCol + dc;
        if (c < 0 || c > 7) continue;
        if (state.board[pawnRank][c] == pawn) {
            for (const Move& m : GenerateLegalMoves(state, pawnRank, c))
                if (m.special == SpecialMove::EnPassant) return true;
        }
    }
    return false;
}

bool Rules::IsThreefoldRepetition(const GameState& state) {
    if (state.positionKeys.empty()) return false;
    const std::string& cur = state.positionKeys.back();
    int count = 0;
    for (const std::string& k : state.positionKeys)
        if (k == cur) ++count;
    return count >= 3;
}

bool Rules::IsInsufficientMaterial(const GameState& state) {
    std::vector<std::pair<char,int>> white, black; // (piece, r*8+c)
    for (int r = 0; r < 8; ++r)
        for (int c = 0; c < 8; ++c) {
            char p = state.board[r][c];
            if (p == '.' || std::toupper(static_cast<unsigned char>(p)) == 'K') continue;
            char up = static_cast<char>(toupper(static_cast<unsigned char>(p)));
            if (up == 'P' || up == 'R' || up == 'Q') return false;
            if (std::isupper(static_cast<unsigned char>(p))) white.push_back({p, r*8+c});
            else black.push_back({p, r*8+c});
        }
    int total = (int)white.size() + (int)black.size();
    if (total == 0) return true;          // K vs K
    if (total == 1) return true;          // K + 单象 / 单马 vs K
    if (total == 2) {
        if (white.size() == 1 && black.size() == 1) return true; // 各执一子
        const auto& side = (white.size() == 2) ? white : black;
        char a = static_cast<char>(toupper(side[0].first));
        char b = static_cast<char>(toupper(side[1].first));
        if (a == 'B' && b == 'B') {
            int color0 = (side[0].second / 8 + side[0].second % 8) % 2;
            int color1 = (side[1].second / 8 + side[1].second % 8) % 2;
            return color0 == color1; // 同色格双象=和棋，异色格可杀
        }
        if (a == 'N' && b == 'N') return true; // 双马 vs K（和棋）
        return false;
    }
    return false;
}
