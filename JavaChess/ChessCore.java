// =============================================================================
// ChessCore.java — 国际象棋核心引擎（Java 17，对齐 CppChess 参考实现）
// -----------------------------------------------------------------------------
// 单文件包含：SpecialMove 枚举 + Move 结构 + GameState 对局状态 + Rules 规则引擎。
// 零第三方依赖，仅用 JDK 标准库。逻辑逐字对齐 chess_core.h/.cpp。
//
// 棋盘表示：board[row][col]
//   row 0 = 第 8 横线（黑方底线，屏幕上方）；row 7 = 第 1 横线（白方底线，下方）
//   col 0..7 = a..h 文件
//   大写字母 = 白方棋子 K Q R B N P；小写 = 黑方 k q r b n p；'.' = 空格
// =============================================================================

import java.util.ArrayList;
import java.util.List;

// ---------------------------- 特殊走法类型 ----------------------------
enum SpecialMove {
    None,            // 0
    DoublePawn,      // 1 兵双重进兵（设置过路兵目标格）
    EnPassant,       // 2 吃过路兵
    CastleKingside,  // 3 短易位（王翼易位）
    CastleQueenside, // 4 长易位（后翼易位）
    Promotion        // 5 兵升变
}

// ---------------------------- 走法结构 ----------------------------
class Move {
    int fromRow = 0;
    int fromCol = 0;
    int toRow = 0;
    int toCol = 0;
    char piece = '.';     // 走动的棋子
    char captured = '.';  // 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
    SpecialMove special = SpecialMove.None;
    char promotion = '.'; // 升变目标棋子（升变时有效）

    boolean isCapture() { return captured != '.'; }

    // 长式代数记谱（无歧义，与 C++ Move::toString 完全一致）
    @Override
    public String toString() {
        if (special == SpecialMove.CastleKingside) return "O-O";
        if (special == SpecialMove.CastleQueenside) return "O-O-O";
        String files = "abcdefgh";
        char fromFile = files.charAt(fromCol);
        char fromRank = (char) ('0' + (8 - fromRow));
        char toFile = files.charAt(toCol);
        char toRank = (char) ('0' + (8 - toRow));
        String fromSq = "" + fromFile + fromRank;
        String toSq = "" + toFile + toRank;
        if (piece == 'P' || piece == 'p') {
            String s = "";
            if (isCapture()) s += fromFile; // 兵吃子记来源文件
            s += toSq;
            if (special == SpecialMove.Promotion) {
                s += '=';
                s += Character.toUpperCase(promotion);
            }
            return s;
        } else {
            String s = "" + Character.toUpperCase(piece);
            s += fromSq;
            if (isCapture()) s += 'x';
            s += toSq;
            return s;
        }
    }
}

// ---------------------------- 对局状态 ----------------------------
class GameState {
    char[][] board = new char[8][8];
    boolean whiteToMove = true;
    // 易位权（跟踪王/车是否动过、角上车是否被吃）
    boolean canCastleWK = true;
    boolean canCastleWQ = true;
    boolean canCastleBK = true;
    boolean canCastleBQ = true;
    // 过路兵目标格（上一步双进兵跳过的格），-1 表示无
    int enPassantRow = -1;
    int enPassantCol = -1;
    // 50 步规则半步计数（吃子或动兵清零）
    int halfmoveClock = 0;
    int fullmoveNumber = 1;
    // 记谱历史（长式代数记谱）
    List<String> history = new ArrayList<>();
    // 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
    List<String> positionKeys = new ArrayList<>();

    GameState() { ResetToStartPosition(); }

    void ResetToStartPosition() {
        String back = "rnbqkbnr";
        for (int c = 0; c < 8; ++c) {
            board[0][c] = back.charAt(c);
            board[1][c] = 'p';
            board[2][c] = '.';
            board[3][c] = '.';
            board[4][c] = '.';
            board[5][c] = '.';
            board[6][c] = 'P';
            board[7][c] = Character.toUpperCase(back.charAt(c));
        }
        whiteToMove = true;
        canCastleWK = canCastleWQ = canCastleBK = canCastleBQ = true;
        enPassantRow = enPassantCol = -1;
        halfmoveClock = 0;
        fullmoveNumber = 1;
        history.clear();
        positionKeys.clear();
        positionKeys.add(GetPositionKey());
    }

    // 局面键：影响重复判定的全部状态
    String GetPositionKey() {
        StringBuilder s = new StringBuilder(90);
        for (int r = 0; r < 8; ++r)
            for (int c = 0; c < 8; ++c)
                s.append(board[r][c]);
        s.append(whiteToMove ? 'w' : 'b');
        s.append(canCastleWK ? 'K' : '-');
        s.append(canCastleWQ ? 'Q' : '-');
        s.append(canCastleBK ? 'k' : '-');
        s.append(canCastleBQ ? 'q' : '-');
        if (Rules.HasLegalEnPassant(this)) {
            s.append(enPassantRow);
            s.append(',');
            s.append(enPassantCol);
        } else {
            s.append("-1,-1");
        }
        return s.toString();
    }

    // 深拷贝（含记谱与局面键）
    GameState Clone() {
        GameState g = new GameState();
        copyBoard(g.board, this.board);
        g.whiteToMove = this.whiteToMove;
        g.canCastleWK = this.canCastleWK; g.canCastleWQ = this.canCastleWQ;
        g.canCastleBK = this.canCastleBK; g.canCastleBQ = this.canCastleBQ;
        g.enPassantRow = this.enPassantRow; g.enPassantCol = this.enPassantCol;
        g.halfmoveClock = this.halfmoveClock; g.fullmoveNumber = this.fullmoveNumber;
        g.history = new ArrayList<>(this.history);
        g.positionKeys = new ArrayList<>(this.positionKeys);
        return g;
    }

    // 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝，降低每节点开销）
    GameState CloneLight() {
        GameState g = new GameState();
        copyBoard(g.board, this.board);
        g.whiteToMove = this.whiteToMove;
        g.canCastleWK = this.canCastleWK; g.canCastleWQ = this.canCastleWQ;
        g.canCastleBK = this.canCastleBK; g.canCastleBQ = this.canCastleBQ;
        g.enPassantRow = this.enPassantRow; g.enPassantCol = this.enPassantCol;
        g.halfmoveClock = this.halfmoveClock; g.fullmoveNumber = this.fullmoveNumber;
        // 轻量克隆：跳过 history 与 positionKeys（AI 搜索不关心记谱/重复判定）
        g.history = new ArrayList<>();
        g.positionKeys = new ArrayList<>();
        return g;
    }

    private static void copyBoard(char[][] dst, char[][] src) {
        for (int r = 0; r < 8; ++r)
            System.arraycopy(src[r], 0, dst[r], 0, 8);
    }
}

// ---------------------------- 规则引擎 ----------------------------
class Rules {

    // ===== 基础工具 =====
    static boolean InBoard(int r, int c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
    static boolean IsWhitePiece(char p) { return p != '.' && Character.isUpperCase(p); }
    static boolean IsBlackPiece(char p) { return p != '.' && Character.isLowerCase(p); }
    static boolean IsPieceOfSide(char p, boolean white) {
        if (p == '.') return false;
        return white ? Character.isUpperCase(p) : Character.isLowerCase(p);
    }

    // ===== IsAttacked：单一例程支撑整个规则库 =====
    static boolean IsAttacked(char[][] board, int r, int c, boolean byWhite) {
        // --- 1. 兵攻击（白兵攻击其上方两斜格，黑兵反之） ---
        char pawn = byWhite ? 'P' : 'p';
        int pr = byWhite ? r + 1 : r - 1;
        if (pr >= 0 && pr <= 7) {
            if (c - 1 >= 0 && board[pr][c - 1] == pawn) return true;
            if (c + 1 <= 7 && board[pr][c + 1] == pawn) return true;
        }

        // --- 2. 马攻击（8 个 L 形跳位） ---
        char knight = byWhite ? 'N' : 'n';
        int[] dr2 = {-2, -2, -1, -1, 1, 1, 2, 2};
        int[] dc2 = {-1, 1, -2, 2, -2, 2, -1, 1};
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
        int[] dirR = {-1, 1, 0, 0, -1, -1, 1, 1};
        int[] dirC = {0, 0, -1, 1, -1, 1, -1, 1};
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

    // ===== 伪合法走法生成（仅几何规则，未过滤送王） =====
    static List<Move> GeneratePseudoMoves(GameState state, int r, int c) {
        List<Move> list = new ArrayList<>();
        char[][] b = state.board;
        char p = b[r][c];
        if (p == '.') return list;

        boolean isWhite = Character.isUpperCase(p);
        char enemyPawn = isWhite ? 'p' : 'P';

        switch (Character.toUpperCase(p)) {
            case 'P': GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn); break;
            case 'N': {
                int[] dr = {-2, -2, -1, -1, 1, 1, 2, 2};
                int[] dc = {-1, 1, -2, 2, -2, 2, -1, 1};
                GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
            } break;
            case 'K': {
                int[] dr = {-1, -1, -1, 0, 0, 1, 1, 1};
                int[] dc = {-1, 0, 1, -1, 1, -1, 0, 1};
                GenerateOffsetMoves(list, b, r, c, isWhite, dr, dc, 8);
                GenerateCastlingMoves(list, state, r, c, isWhite);
            } break;
            case 'B': {
                int[] dr = {-1, -1, 1, 1};
                int[] dc = {-1, 1, -1, 1};
                GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
            } break;
            case 'R': {
                int[] dr = {-1, 1, 0, 0};
                int[] dc = {0, 0, -1, 1};
                GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 4);
            } break;
            case 'Q': {
                int[] dr = {-1, 1, 0, 0, -1, -1, 1, 1};
                int[] dc = {0, 0, -1, 1, -1, 1, -1, 1};
                GenerateSlidingMoves(list, b, r, c, isWhite, dr, dc, 8);
            } break;
        }
        return list;
    }

    // ===== 合法走法（两阶段） =====
    static List<Move> GenerateLegalMoves(GameState state, int r, int c) {
        List<Move> legal = new ArrayList<>();
        List<Move> pseudo = GeneratePseudoMoves(state, r, c);
        if (pseudo.isEmpty()) return legal;

        boolean moverIsWhite = Character.isUpperCase(state.board[r][c]);
        for (Move m : pseudo) {
            GameState sim = state.CloneLight();
            ApplyMove(sim, m, false);
            int[] k = FindKing(sim.board, moverIsWhite);
            if (!IsAttacked(sim.board, k[0], k[1], !moverIsWhite))
                legal.add(m);
        }
        return legal;
    }

    static List<Move> GenerateAllLegalMoves(GameState state) {
        List<Move> all = new ArrayList<>();
        for (int r = 0; r < 8; ++r)
            for (int c = 0; c < 8; ++c)
                if (IsPieceOfSide(state.board[r][c], state.whiteToMove))
                    all.addAll(GenerateLegalMoves(state, r, c));
        return all;
    }

    // ===== 走子执行（增量更新状态） =====
    // 2 参数便捷重载：等价于 recordHistory=true（供规则测试与交互路径使用，对齐 C# 版 ApplyMove(s,m)）
    static void ApplyMove(GameState state, Move m) {
        ApplyMove(state, m, true);
    }

    // recordHistory=false 供 AI 搜索路径使用（跳过记谱与局面键，降低开销）
    static void ApplyMove(GameState state, Move m, boolean recordHistory) {
        char[][] b = state.board;

        // 1. 移动棋子本体
        b[m.toRow][m.toCol] = m.piece;
        b[m.fromRow][m.fromCol] = '.';

        // 2. 特殊走法处理
        switch (m.special) {
            case DoublePawn:
                state.enPassantRow = (m.fromRow + m.toRow) / 2;
                state.enPassantCol = m.fromCol;
                break;
            case EnPassant: {
                int capRow = (m.piece == 'P') ? m.toRow + 1 : m.toRow - 1;
                b[capRow][m.toCol] = '.';
            } break;
            case CastleKingside:
                b[m.fromRow][5] = b[m.fromRow][7];
                b[m.fromRow][7] = '.';
                break;
            case CastleQueenside:
                b[m.fromRow][3] = b[m.fromRow][0];
                b[m.fromRow][0] = '.';
                break;
            case Promotion:
                b[m.toRow][m.toCol] = m.promotion;
                break;
            default: break;
        }

        // 3. 非双进兵时清除过路兵目标格
        if (m.special != SpecialMove.DoublePawn) {
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
        if (Character.toUpperCase(m.piece) == 'P' || m.captured != '.')
            state.halfmoveClock = 0;
        else
            state.halfmoveClock += 1;

        // 6. 回合切换与记谱
        if (!state.whiteToMove) state.fullmoveNumber += 1;
        state.whiteToMove = !state.whiteToMove;
        if (recordHistory) {
            state.history.add(m.toString());
            state.positionKeys.add(state.GetPositionKey());
        }
    }

    // ===== 王定位与将军检测 =====
    static int[] FindKing(char[][] board, boolean isWhite) {
        char k = isWhite ? 'K' : 'k';
        int[] res = {-1, -1};
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j)
                if (board[i][j] == k) { res[0] = i; res[1] = j; return res; }
        return res;
    }

    static boolean IsInCheck(GameState state, boolean isWhite) {
        int[] k = FindKing(state.board, isWhite);
        if (k[0] < 0) return false;
        return IsAttacked(state.board, k[0], k[1], !isWhite);
    }

    // ===== 终局判定 =====
    static boolean IsCheckmate(GameState state) {
        return IsInCheck(state, state.whiteToMove) && GenerateAllLegalMoves(state).isEmpty();
    }
    static boolean IsStalemate(GameState state) {
        return !IsInCheck(state, state.whiteToMove) && GenerateAllLegalMoves(state).isEmpty();
    }
    static boolean IsFiftyMoveDraw(GameState state) {
        return state.halfmoveClock >= 100;
    }

    // 是否存在合法的吃过路兵着法（供三次重复局面键决定是否编码 ep 格）
    static boolean HasLegalEnPassant(GameState state) {
        if (state.enPassantRow < 0) return false;
        int pawnRank = state.whiteToMove ? state.enPassantRow + 1 : state.enPassantRow - 1;
        if (pawnRank < 0 || pawnRank > 7) return false;
        char pawn = state.whiteToMove ? 'P' : 'p';
        for (int dc = -1; dc <= 1; dc += 2) {
            int c = state.enPassantCol + dc;
            if (c < 0 || c > 7) continue;
            if (state.board[pawnRank][c] == pawn) {
                for (Move m : GenerateLegalMoves(state, pawnRank, c))
                    if (m.special == SpecialMove.EnPassant) return true;
            }
        }
        return false;
    }

    static boolean IsThreefoldRepetition(GameState state) {
        if (state.positionKeys.isEmpty()) return false;
        String cur = state.positionKeys.get(state.positionKeys.size() - 1);
        int count = 0;
        for (String key : state.positionKeys)
            if (key.equals(cur)) ++count;
        return count >= 3;
    }

    // 子力不足和棋（扩展版：KK / K+单象 / K+单马 / KNN / 异色格象组合等真实和棋）
    // 收集非王非空格子的位置（r*8+c），与 C++ 的 (piece, r*8+c) 等价
    static boolean IsInsufficientMaterial(GameState state) {
        List<Integer> white = new ArrayList<>();
        List<Integer> black = new ArrayList<>();
        for (int r = 0; r < 8; ++r)
            for (int c = 0; c < 8; ++c) {
                char p = state.board[r][c];
                if (p == '.' || Character.toUpperCase(p) == 'K') continue;
                char up = Character.toUpperCase(p);
                if (up == 'P' || up == 'R' || up == 'Q') return false;
                int pos = r * 8 + c;
                if (Character.isUpperCase(p)) white.add(pos);
                else black.add(pos);
            }
        int total = white.size() + black.size();
        if (total == 0) return true;          // K vs K
        if (total == 1) return true;          // K + 单象 / 单马 vs K
        if (total == 2) {
            if (white.size() == 1 && black.size() == 1) return true; // 各执一子
            List<Integer> side = (white.size() == 2) ? white : black;
            char a = Character.toUpperCase(state.board[side.get(0) / 8][side.get(0) % 8]);
            char bb = Character.toUpperCase(state.board[side.get(1) / 8][side.get(1) % 8]);
            if (a == 'B' && bb == 'B') {
                int colorA = (side.get(0) / 8 + side.get(0) % 8) % 2;
                int colorB = (side.get(1) / 8 + side.get(1) % 8) % 2;
                return colorA == colorB; // 同色格双象=和棋，异色格可杀
            }
            if (a == 'N' && bb == 'N') return true; // 双马 vs K（和棋）
            return false;
        }
        return false;
    }

    // ===== 私有走法生成辅助 =====
    private static void GeneratePawnMoves(List<Move> list, GameState state,
                                          int r, int c, boolean isWhite, char enemyPawn) {
        char[][] b = state.board;
        int dir = isWhite ? -1 : 1;
        int startRow = isWhite ? 6 : 1;

        // 前进一格（目标格须为空）
        if (InBoard(r + dir, c) && b[r + dir][c] == '.') {
            AddPawnMove(list, r, c, r + dir, c, '.', SpecialMove.None, isWhite);
            // 起始位置双重进兵
            if (r == startRow && b[r + 2 * dir][c] == '.') {
                Move m = new Move();
                m.fromRow = r; m.fromCol = c; m.toRow = r + 2 * dir; m.toCol = c;
                m.piece = b[r][c]; m.captured = '.'; m.special = SpecialMove.DoublePawn; m.promotion = '.';
                list.add(m);
            }
        }

        // 斜吃 / 吃过路兵
        int[] dcs = {-1, 1};
        for (int dc : dcs) {
            int tr = r + dir, tc = c + dc;
            if (!InBoard(tr, tc)) continue;
            char target = b[tr][tc];
            if (target != '.' && IsPieceOfSide(target, !isWhite)) {
                AddPawnMove(list, r, c, tr, tc, target, SpecialMove.None, isWhite);
            } else if (tr == state.enPassantRow && tc == state.enPassantCol) {
                AddPawnMove(list, r, c, tr, tc, enemyPawn, SpecialMove.EnPassant, isWhite);
            }
        }
    }

    private static void AddPawnMove(List<Move> list, int fr, int fc, int tr, int tc,
                                    char captured, SpecialMove special, boolean isWhite) {
        if (tr == 0 || tr == 7) {
            String promos = "QRBN";
            for (int i = 0; i < 4; ++i) {
                Move m = new Move();
                m.fromRow = fr; m.fromCol = fc; m.toRow = tr; m.toCol = tc;
                m.piece = isWhite ? 'P' : 'p';
                m.captured = captured;
                m.special = SpecialMove.Promotion;
                m.promotion = isWhite ? promos.charAt(i) : Character.toLowerCase(promos.charAt(i));
                list.add(m);
            }
        } else {
            Move m = new Move();
            m.fromRow = fr; m.fromCol = fc; m.toRow = tr; m.toCol = tc;
            m.piece = isWhite ? 'P' : 'p';
            m.captured = captured;
            m.special = special;
            m.promotion = '.';
            list.add(m);
        }
    }

    private static void GenerateOffsetMoves(List<Move> list, char[][] board,
                                            int r, int c, boolean isWhite,
                                            int[] dr, int[] dc, int n) {
        char p = board[r][c];
        for (int i = 0; i < n; ++i) {
            int tr = r + dr[i], tc = c + dc[i];
            if (!InBoard(tr, tc)) continue;
            char target = board[tr][tc];
            if (target == '.' || IsPieceOfSide(target, !isWhite)) {
                Move m = new Move();
                m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
                m.piece = p; m.captured = target; m.special = SpecialMove.None; m.promotion = '.';
                list.add(m);
            }
        }
    }

    private static void GenerateSlidingMoves(List<Move> list, char[][] board,
                                             int r, int c, boolean isWhite,
                                             int[] dr, int[] dc, int n) {
        char p = board[r][c];
        for (int i = 0; i < n; ++i) {
            int tr = r + dr[i], tc = c + dc[i];
            while (InBoard(tr, tc)) {
                char target = board[tr][tc];
                if (target == '.') {
                    Move m = new Move();
                    m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
                    m.piece = p; m.captured = '.'; m.special = SpecialMove.None; m.promotion = '.';
                    list.add(m);
                } else {
                    if (IsPieceOfSide(target, !isWhite)) {
                        Move m = new Move();
                        m.fromRow = r; m.fromCol = c; m.toRow = tr; m.toCol = tc;
                        m.piece = p; m.captured = target; m.special = SpecialMove.None; m.promotion = '.';
                        list.add(m);
                    }
                    break;
                }
                tr += dr[i]; tc += dc[i];
            }
        }
    }

    private static void GenerateCastlingMoves(List<Move> list, GameState state,
                                              int r, int c, boolean isWhite) {
        char[][] b = state.board;
        if (isWhite) {
            if (r != 7 || c != 4) return;
            // 白方短易位：K e1→g1，R h1→f1
            if (state.canCastleWK && b[7][7] == 'R' && b[7][5] == '.' && b[7][6] == '.') {
                if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 5, false) && !IsAttacked(b, 7, 6, false)) {
                    Move m = new Move(); m.fromRow = 7; m.fromCol = 4; m.toRow = 7; m.toCol = 6;
                    m.piece = 'K'; m.captured = '.'; m.special = SpecialMove.CastleKingside; m.promotion = '.';
                    list.add(m);
                }
            }
            // 白方长易位：K e1→c1，R a1→d1
            if (state.canCastleWQ && b[7][0] == 'R' && b[7][1] == '.' && b[7][2] == '.' && b[7][3] == '.') {
                if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 3, false) && !IsAttacked(b, 7, 2, false)) {
                    Move m = new Move(); m.fromRow = 7; m.fromCol = 4; m.toRow = 7; m.toCol = 2;
                    m.piece = 'K'; m.captured = '.'; m.special = SpecialMove.CastleQueenside; m.promotion = '.';
                    list.add(m);
                }
            }
        } else {
            if (r != 0 || c != 4) return;
            // 黑方短易位：K e8→g8，R h8→f8
            if (state.canCastleBK && b[0][7] == 'r' && b[0][5] == '.' && b[0][6] == '.') {
                if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 5, true) && !IsAttacked(b, 0, 6, true)) {
                    Move m = new Move(); m.fromRow = 0; m.fromCol = 4; m.toRow = 0; m.toCol = 6;
                    m.piece = 'k'; m.captured = '.'; m.special = SpecialMove.CastleKingside; m.promotion = '.';
                    list.add(m);
                }
            }
            // 黑方长易位：K e8→c8，R a8→d8
            if (state.canCastleBQ && b[0][0] == 'r' && b[0][1] == '.' && b[0][2] == '.' && b[0][3] == '.') {
                if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 3, true) && !IsAttacked(b, 0, 2, true)) {
                    Move m = new Move(); m.fromRow = 0; m.fromCol = 4; m.toRow = 0; m.toCol = 2;
                    m.piece = 'k'; m.captured = '.'; m.special = SpecialMove.CastleQueenside; m.promotion = '.';
                    list.add(m);
                }
            }
        }
    }
}
