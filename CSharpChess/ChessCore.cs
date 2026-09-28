// =============================================================================
// ChessCore.cs — 国际象棋核心引擎（C#，逐条对齐 C++ 参考 chess_core.h/.cpp）
// -----------------------------------------------------------------------------
// 架构：
//   1. 数据层：GameState（棋盘 + 行棋方 + 易位权 + 过路兵目标格 + 计数器）
//   2. 规则层：Rules（伪合法走法生成 → 在副本上模拟走子 → IsAttacked 过滤）
//   3. 终局层：将军 / 将死 / 逼和 / 50 步规则 / 子力不足 / 三次重复
//
// 棋盘表示（mailbox 方案，8x8 二维字符数组）：
//   Board[row, col]
//     row 0 = 第 8 横线（黑方底线，屏幕上方）
//     row 7 = 第 1 横线（白方底线，屏幕下方）
//   大写 = 白方棋子  K Q R B N P
//   小写 = 黑方棋子  k q r b n p
//   '.'   = 空格
//
// 核心思路：
//   - IsAttacked() 单一例程支撑整个规则库（将军检测 / 易位路径安全 / 合法性过滤）
//   - 合法走法 = 伪合法走法（几何规则） - 会使己方王被攻击的走法
// =============================================================================

using System;
using System.Collections.Generic;
using System.Text;

namespace ChessEngine
{
    // ---------------------------- 特殊走法类型 ----------------------------
    public enum SpecialMove
    {
        None = 0,
        DoublePawn = 1,      // 兵双重进兵（设置过路兵目标格）
        EnPassant = 2,       // 吃过路兵
        CastleKingside = 3,  // 短易位（王翼易位）
        CastleQueenside = 4, // 长易位（后翼易位）
        Promotion = 5        // 兵升变
    }

    // ---------------------------- 走法 ----------------------------
    // 采用 class（引用类型）以精确复刻 C++ `struct Move` 的默认成员值
    // （piece/captured/promotion 默认 '.'），并让 Move? 直接映射 std::optional<Move>。
    public class Move
    {
        public int FromRow = 0;
        public int FromCol = 0;
        public int ToRow = 0;
        public int ToCol = 0;
        public char Piece = '.';     // 走动的棋子
        public char Captured = '.';  // 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
        public SpecialMove Special = SpecialMove.None;
        public char Promotion = '.'; // 升变目标棋子（升变时有效）

        public bool IsCapture => Captured != '.';

        // 对齐 C++ Move::operator==
        public bool Equals(Move o)
        {
            return FromRow == o.FromRow && FromCol == o.FromCol &&
                   ToRow == o.ToRow && ToCol == o.ToCol &&
                   Piece == o.Piece && Special == o.Special && Promotion == o.Promotion;
        }

        // 长式代数记谱（无歧义），对齐 C++ Move::toString
        public override string ToString()
        {
            if (Special == SpecialMove.CastleKingside) return "O-O";
            if (Special == SpecialMove.CastleQueenside) return "O-O-O";
            const string files = "abcdefgh";
            string fromSq = files[FromCol].ToString() + (char)('0' + (8 - FromRow));
            string toSq = files[ToCol].ToString() + (char)('0' + (8 - ToRow));
            if (Piece == 'P' || Piece == 'p')
            {
                string s = string.Empty;
                if (IsCapture) s += files[FromCol]; // 兵吃子记来源文件
                s += toSq;
                if (Special == SpecialMove.Promotion)
                {
                    s += '=';
                    s += char.ToUpperInvariant(Promotion);
                }
                return s;
            }
            else
            {
                string s = string.Empty;
                s += char.ToUpperInvariant(Piece);
                s += fromSq;
                if (IsCapture) s += 'x';
                s += toSq;
                return s;
            }
        }
    }

    // ---------------------------- 对局状态 ----------------------------
    public class GameState
    {
        public char[,] Board = new char[8, 8];
        public bool WhiteToMove = true;
        // 易位权（跟踪王/车是否动过、角上车是否被吃）
        public bool CanCastleWK = true;
        public bool CanCastleWQ = true;
        public bool CanCastleBK = true;
        public bool CanCastleBQ = true;
        // 过路兵目标格（上一步双进兵跳过的格），-1 表示无
        public int EnPassantRow = -1;
        public int EnPassantCol = -1;
        // 50 步规则半步计数（吃子或动兵清零）
        public int HalfmoveClock = 0;
        public int FullmoveNumber = 1;
        // 记谱历史（长式代数记谱）
        public List<string> History = new List<string>();
        // 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
        public List<string> PositionKeys = new List<string>();

        // 初始局面键是常量，缓存以避免 CloneLight() 在搜索热路径上重复构串
        // （不改变任何可观察语义，仅省去重复计算）
        private static string? _startPositionKey;

        public GameState() { ResetToStartPosition(); }

        public void ResetToStartPosition()
        {
            const string back = "rnbqkbnr";
            for (int c = 0; c < 8; ++c)
            {
                Board[0, c] = back[c];
                Board[1, c] = 'p';
                Board[2, c] = '.';
                Board[3, c] = '.';
                Board[4, c] = '.';
                Board[5, c] = '.';
                Board[6, c] = 'P';
                Board[7, c] = char.ToUpperInvariant(back[c]);
            }
            WhiteToMove = true;
            CanCastleWK = CanCastleWQ = CanCastleBK = CanCastleBQ = true;
            EnPassantRow = EnPassantCol = -1;
            HalfmoveClock = 0;
            FullmoveNumber = 1;
            History.Clear();
            PositionKeys.Clear();
            _startPositionKey ??= GetPositionKey();
            PositionKeys.Add(_startPositionKey);
        }

        // 局面键：影响重复判定的全部状态
        public string GetPositionKey()
        {
            StringBuilder s = new StringBuilder(90);
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                    s.Append(Board[r, c]);
            s.Append(WhiteToMove ? 'w' : 'b');
            s.Append(CanCastleWK ? 'K' : '-');
            s.Append(CanCastleWQ ? 'Q' : '-');
            s.Append(CanCastleBK ? 'k' : '-');
            s.Append(CanCastleBQ ? 'q' : '-');
            if (Rules.HasLegalEnPassant(this))
            {
                s.Append(EnPassantRow.ToString());
                s.Append(',');
                s.Append(EnPassantCol.ToString());
            }
            else
            {
                s.Append("-1,-1");
            }
            return s.ToString();
        }

        // 深拷贝（含记谱与局面键）
        public GameState Clone()
        {
            GameState s = new GameState();
            s.Board = (char[,])Board.Clone();
            s.WhiteToMove = WhiteToMove;
            s.CanCastleWK = CanCastleWK; s.CanCastleWQ = CanCastleWQ;
            s.CanCastleBK = CanCastleBK; s.CanCastleBQ = CanCastleBQ;
            s.EnPassantRow = EnPassantRow; s.EnPassantCol = EnPassantCol;
            s.HalfmoveClock = HalfmoveClock; s.FullmoveNumber = FullmoveNumber;
            s.History = new List<string>(History);
            s.PositionKeys = new List<string>(PositionKeys);
            return s;
        }

        // 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝，降低每节点开销）
        // 与 C++ 一致：新对象保留默认构造结果（History 空、PositionKeys 含初始局面键）
        public GameState CloneLight()
        {
            GameState s = new GameState();
            s.Board = (char[,])Board.Clone();
            s.WhiteToMove = WhiteToMove;
            s.CanCastleWK = CanCastleWK; s.CanCastleWQ = CanCastleWQ;
            s.CanCastleBK = CanCastleBK; s.CanCastleBQ = CanCastleBQ;
            s.EnPassantRow = EnPassantRow; s.EnPassantCol = EnPassantCol;
            s.HalfmoveClock = HalfmoveClock; s.FullmoveNumber = FullmoveNumber;
            return s;
        }
    }

    // ---------------------------- 规则引擎 ----------------------------
    public static class Rules
    {
        // ===== 基础工具 =====
        public static bool InBoard(int r, int c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
        public static bool IsWhitePiece(char p) { return p != '.' && char.IsUpper(p); }
        public static bool IsBlackPiece(char p) { return p != '.' && char.IsLower(p); }
        public static bool IsPieceOfSide(char p, bool white)
        {
            if (p == '.') return false;
            return white ? char.IsUpper(p) : char.IsLower(p);
        }

        // ===== IsAttacked：单一例程支撑整个规则库 =====
        private static readonly int[] KnightDR = { -2, -2, -1, -1, 1, 1, 2, 2 };
        private static readonly int[] KnightDC = { -1, 1, -2, 2, -2, 2, -1, 1 };
        private static readonly int[] KingDR = { -1, -1, -1, 0, 0, 1, 1, 1 };
        private static readonly int[] KingDC = { -1, 0, 1, -1, 1, -1, 0, 1 };
        private static readonly int[] BishopDR = { -1, -1, 1, 1 };
        private static readonly int[] BishopDC = { -1, 1, -1, 1 };
        private static readonly int[] RookDR = { -1, 1, 0, 0 };
        private static readonly int[] RookDC = { 0, 0, -1, 1 };
        private static readonly int[] QueenDR = { -1, 1, 0, 0, -1, -1, 1, 1 };
        private static readonly int[] QueenDC = { 0, 0, -1, 1, -1, 1, -1, 1 };
        // 射线方向：前 4 = 直线（车/后），后 4 = 斜线（象/后）
        private static readonly int[] RayDR = { -1, 1, 0, 0, -1, -1, 1, 1 };
        private static readonly int[] RayDC = { 0, 0, -1, 1, -1, 1, -1, 1 };

        public static bool IsAttacked(char[,] board, int r, int c, bool byWhite)
        {
            // --- 1. 兵攻击（白兵攻击其上方两斜格，黑兵反之） ---
            char pawn = byWhite ? 'P' : 'p';
            int pr = byWhite ? r + 1 : r - 1;
            if (pr >= 0 && pr <= 7)
            {
                if (c - 1 >= 0 && board[pr, c - 1] == pawn) return true;
                if (c + 1 <= 7 && board[pr, c + 1] == pawn) return true;
            }

            // --- 2. 马攻击（8 个 L 形跳位） ---
            char knight = byWhite ? 'N' : 'n';
            for (int i = 0; i < 8; ++i)
            {
                int tr = r + KnightDR[i], tc = c + KnightDC[i];
                if (InBoard(tr, tc) && board[tr, tc] == knight) return true;
            }

            // --- 3. 王攻击（8 邻格） ---
            char king = byWhite ? 'K' : 'k';
            for (int dr = -1; dr <= 1; ++dr)
                for (int dc = -1; dc <= 1; ++dc)
                {
                    if (dr == 0 && dc == 0) continue;
                    int tr = r + dr, tc = c + dc;
                    if (InBoard(tr, tc) && board[tr, tc] == king) return true;
                }

            // --- 4. 滑动射线攻击：直线（车/后）+ 斜线（象/后） ---
            char rook = byWhite ? 'R' : 'r';
            char queen = byWhite ? 'Q' : 'q';
            char bishop = byWhite ? 'B' : 'b';
            for (int i = 0; i < 8; ++i)
            {
                int tr = r + RayDR[i], tc = c + RayDC[i];
                while (InBoard(tr, tc))
                {
                    char p = board[tr, tc];
                    if (p != '.')
                    {
                        if (i < 4) { if (p == rook || p == queen) return true; }
                        else { if (p == bishop || p == queen) return true; }
                        break;
                    }
                    tr += RayDR[i]; tc += RayDC[i];
                }
            }
            return false;
        }

        // ---------------------------- 兵走法 ----------------------------
        private static readonly int[] PawnCaptureDC = { -1, 1 };

        private static void GeneratePawnMoves(List<Move> list, GameState state,
                                              int r, int c, bool isWhite, char enemyPawn)
        {
            char[,] b = state.Board;
            int dir = isWhite ? -1 : 1;
            int startRow = isWhite ? 6 : 1;

            // 前进一格（目标格须为空）
            if (InBoard(r + dir, c) && b[r + dir, c] == '.')
            {
                AddPawnMove(list, r, c, r + dir, c, '.', SpecialMove.None, isWhite);
                // 起始位置双重进兵
                if (r == startRow && b[r + 2 * dir, c] == '.')
                {
                    Move m = new Move();
                    m.FromRow = r; m.FromCol = c; m.ToRow = r + 2 * dir; m.ToCol = c;
                    m.Piece = b[r, c]; m.Captured = '.'; m.Special = SpecialMove.DoublePawn; m.Promotion = '.';
                    list.Add(m);
                }
            }

            // 斜吃 / 吃过路兵
            for (int i = 0; i < 2; ++i)
            {
                int dc = PawnCaptureDC[i];
                int tr = r + dir, tc = c + dc;
                if (!InBoard(tr, tc)) continue;
                char target = b[tr, tc];
                if (target != '.' && IsPieceOfSide(target, !isWhite))
                {
                    AddPawnMove(list, r, c, tr, tc, target, SpecialMove.None, isWhite);
                }
                else if (tr == state.EnPassantRow && tc == state.EnPassantCol)
                {
                    AddPawnMove(list, r, c, tr, tc, enemyPawn, SpecialMove.EnPassant, isWhite);
                }
            }
        }

        private static void AddPawnMove(List<Move> list, int fr, int fc, int tr, int tc,
                                        char captured, SpecialMove special, bool isWhite)
        {
            if (tr == 0 || tr == 7)
            {
                const string promos = "QRBN";
                for (int i = 0; i < 4; ++i)
                {
                    Move m = new Move();
                    m.FromRow = fr; m.FromCol = fc; m.ToRow = tr; m.ToCol = tc;
                    m.Piece = isWhite ? 'P' : 'p';
                    m.Captured = captured;
                    m.Special = SpecialMove.Promotion;
                    m.Promotion = isWhite ? promos[i] : char.ToLowerInvariant(promos[i]);
                    list.Add(m);
                }
            }
            else
            {
                Move m = new Move();
                m.FromRow = fr; m.FromCol = fc; m.ToRow = tr; m.ToCol = tc;
                m.Piece = isWhite ? 'P' : 'p';
                m.Captured = captured;
                m.Special = special;
                m.Promotion = '.';
                list.Add(m);
            }
        }

        // ---------------------------- 马/王固定偏移 ----------------------------
        private static void GenerateOffsetMoves(List<Move> list, char[,] board,
                                                int r, int c, bool isWhite,
                                                int[] dr, int[] dc, int n)
        {
            char p = board[r, c];
            for (int i = 0; i < n; ++i)
            {
                int tr = r + dr[i], tc = c + dc[i];
                if (!InBoard(tr, tc)) continue;
                char target = board[tr, tc];
                if (target == '.' || IsPieceOfSide(target, !isWhite))
                {
                    Move m = new Move();
                    m.FromRow = r; m.FromCol = c; m.ToRow = tr; m.ToCol = tc;
                    m.Piece = p; m.Captured = target; m.Special = SpecialMove.None; m.Promotion = '.';
                    list.Add(m);
                }
            }
        }

        // ---------------------------- 象/车/后滑动 ----------------------------
        private static void GenerateSlidingMoves(List<Move> list, char[,] board,
                                                 int r, int c, bool isWhite,
                                                 int[] dr, int[] dc, int n)
        {
            char p = board[r, c];
            for (int i = 0; i < n; ++i)
            {
                int tr = r + dr[i], tc = c + dc[i];
                while (InBoard(tr, tc))
                {
                    char target = board[tr, tc];
                    if (target == '.')
                    {
                        Move m = new Move();
                        m.FromRow = r; m.FromCol = c; m.ToRow = tr; m.ToCol = tc;
                        m.Piece = p; m.Captured = '.'; m.Special = SpecialMove.None; m.Promotion = '.';
                        list.Add(m);
                    }
                    else
                    {
                        if (IsPieceOfSide(target, !isWhite))
                        {
                            Move m = new Move();
                            m.FromRow = r; m.FromCol = c; m.ToRow = tr; m.ToCol = tc;
                            m.Piece = p; m.Captured = target; m.Special = SpecialMove.None; m.Promotion = '.';
                            list.Add(m);
                        }
                        break;
                    }
                    tr += dr[i]; tc += dc[i];
                }
            }
        }

        // ---------------------------- 王车易位 ----------------------------
        private static void GenerateCastlingMoves(List<Move> list, GameState state,
                                                  int r, int c, bool isWhite)
        {
            char[,] b = state.Board;
            if (isWhite)
            {
                if (r != 7 || c != 4) return;
                // 白方短易位：K e1→g1，R h1→f1
                if (state.CanCastleWK && b[7, 7] == 'R' && b[7, 5] == '.' && b[7, 6] == '.')
                {
                    if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 5, false) && !IsAttacked(b, 7, 6, false))
                    {
                        Move m = new Move();
                        m.FromRow = 7; m.FromCol = 4; m.ToRow = 7; m.ToCol = 6;
                        m.Piece = 'K'; m.Captured = '.'; m.Special = SpecialMove.CastleKingside; m.Promotion = '.';
                        list.Add(m);
                    }
                }
                // 白方长易位：K e1→c1，R a1→d1
                if (state.CanCastleWQ && b[7, 0] == 'R' && b[7, 1] == '.' && b[7, 2] == '.' && b[7, 3] == '.')
                {
                    if (!IsAttacked(b, 7, 4, false) && !IsAttacked(b, 7, 3, false) && !IsAttacked(b, 7, 2, false))
                    {
                        Move m = new Move();
                        m.FromRow = 7; m.FromCol = 4; m.ToRow = 7; m.ToCol = 2;
                        m.Piece = 'K'; m.Captured = '.'; m.Special = SpecialMove.CastleQueenside; m.Promotion = '.';
                        list.Add(m);
                    }
                }
            }
            else
            {
                if (r != 0 || c != 4) return;
                // 黑方短易位：K e8→g8，R h8→f8
                if (state.CanCastleBK && b[0, 7] == 'r' && b[0, 5] == '.' && b[0, 6] == '.')
                {
                    if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 5, true) && !IsAttacked(b, 0, 6, true))
                    {
                        Move m = new Move();
                        m.FromRow = 0; m.FromCol = 4; m.ToRow = 0; m.ToCol = 6;
                        m.Piece = 'k'; m.Captured = '.'; m.Special = SpecialMove.CastleKingside; m.Promotion = '.';
                        list.Add(m);
                    }
                }
                // 黑方长易位：K e8→c8，R a8→d8
                if (state.CanCastleBQ && b[0, 0] == 'r' && b[0, 1] == '.' && b[0, 2] == '.' && b[0, 3] == '.')
                {
                    if (!IsAttacked(b, 0, 4, true) && !IsAttacked(b, 0, 3, true) && !IsAttacked(b, 0, 2, true))
                    {
                        Move m = new Move();
                        m.FromRow = 0; m.FromCol = 4; m.ToRow = 0; m.ToCol = 2;
                        m.Piece = 'k'; m.Captured = '.'; m.Special = SpecialMove.CastleQueenside; m.Promotion = '.';
                        list.Add(m);
                    }
                }
            }
        }

        // ---------------------------- 伪合法走法生成入口 ----------------------------
        public static List<Move> GeneratePseudoMoves(GameState state, int r, int c)
        {
            List<Move> list = new List<Move>();
            char[,] b = state.Board;
            char p = b[r, c];
            if (p == '.') return list;

            bool isWhite = char.IsUpper(p);
            char enemyPawn = isWhite ? 'p' : 'P';

            switch (char.ToUpperInvariant(p))
            {
                case 'P':
                    GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn);
                    break;
                case 'N':
                    GenerateOffsetMoves(list, b, r, c, isWhite, KnightDR, KnightDC, 8);
                    break;
                case 'K':
                    GenerateOffsetMoves(list, b, r, c, isWhite, KingDR, KingDC, 8);
                    GenerateCastlingMoves(list, state, r, c, isWhite);
                    break;
                case 'B':
                    GenerateSlidingMoves(list, b, r, c, isWhite, BishopDR, BishopDC, 4);
                    break;
                case 'R':
                    GenerateSlidingMoves(list, b, r, c, isWhite, RookDR, RookDC, 4);
                    break;
                case 'Q':
                    GenerateSlidingMoves(list, b, r, c, isWhite, QueenDR, QueenDC, 8);
                    break;
            }
            return list;
        }

        // ---------------------------- 合法走法（两阶段） ----------------------------
        public static List<Move> GenerateLegalMoves(GameState state, int r, int c)
        {
            List<Move> legal = new List<Move>();
            List<Move> pseudo = GeneratePseudoMoves(state, r, c);
            if (pseudo.Count == 0) return legal;

            bool moverIsWhite = char.IsUpper(pseudo[0].Piece);
            foreach (Move m in pseudo)
            {
                GameState sim = state.CloneLight();
                ApplyMove(sim, m, false);
                int kr, kc;
                FindKing(sim.Board, moverIsWhite, out kr, out kc);
                if (!IsAttacked(sim.Board, kr, kc, !moverIsWhite))
                    legal.Add(m);
            }
            return legal;
        }

        public static List<Move> GenerateAllLegalMoves(GameState state)
        {
            List<Move> all = new List<Move>();
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                    if (IsPieceOfSide(state.Board[r, c], state.WhiteToMove))
                        foreach (Move m in GenerateLegalMoves(state, r, c))
                            all.Add(m);
            return all;
        }

        // ---------------------------- 走子执行 ----------------------------
        public static void ApplyMove(GameState state, Move m) { ApplyMove(state, m, true); }

        public static void ApplyMove(GameState state, Move m, bool recordHistory)
        {
            char[,] b = state.Board;

            // 1. 移动棋子本体
            b[m.ToRow, m.ToCol] = m.Piece;
            b[m.FromRow, m.FromCol] = '.';

            // 2. 特殊走法处理
            switch (m.Special)
            {
                case SpecialMove.DoublePawn:
                    state.EnPassantRow = (m.FromRow + m.ToRow) / 2;
                    state.EnPassantCol = m.FromCol;
                    break;
                case SpecialMove.EnPassant:
                    {
                        int capRow = (m.Piece == 'P') ? m.ToRow + 1 : m.ToRow - 1;
                        b[capRow, m.ToCol] = '.';
                    }
                    break;
                case SpecialMove.CastleKingside:
                    b[m.FromRow, 5] = b[m.FromRow, 7];
                    b[m.FromRow, 7] = '.';
                    break;
                case SpecialMove.CastleQueenside:
                    b[m.FromRow, 3] = b[m.FromRow, 0];
                    b[m.FromRow, 0] = '.';
                    break;
                case SpecialMove.Promotion:
                    b[m.ToRow, m.ToCol] = m.Promotion;
                    break;
                default:
                    break;
            }

            // 3. 非双进兵时清除过路兵目标格
            if (m.Special != SpecialMove.DoublePawn)
            {
                state.EnPassantRow = -1;
                state.EnPassantCol = -1;
            }

            // 4. 更新易位权
            if (m.Piece == 'K') { state.CanCastleWK = false; state.CanCastleWQ = false; }
            else if (m.Piece == 'k') { state.CanCastleBK = false; state.CanCastleBQ = false; }
            if ((m.FromRow == 7 && m.FromCol == 0) || (m.ToRow == 7 && m.ToCol == 0)) state.CanCastleWQ = false;
            if ((m.FromRow == 7 && m.FromCol == 7) || (m.ToRow == 7 && m.ToCol == 7)) state.CanCastleWK = false;
            if ((m.FromRow == 0 && m.FromCol == 0) || (m.ToRow == 0 && m.ToCol == 0)) state.CanCastleBQ = false;
            if ((m.FromRow == 0 && m.FromCol == 7) || (m.ToRow == 0 && m.ToCol == 7)) state.CanCastleBK = false;

            // 5. 50 步规则计数
            if (char.ToUpperInvariant(m.Piece) == 'P' || m.Captured != '.')
                state.HalfmoveClock = 0;
            else
                state.HalfmoveClock += 1;

            // 6. 回合切换与记谱
            if (!state.WhiteToMove) state.FullmoveNumber += 1;
            state.WhiteToMove = !state.WhiteToMove;
            if (recordHistory)
            {
                state.History.Add(m.ToString());
                state.PositionKeys.Add(state.GetPositionKey());
            }
        }

        // ---------------------------- 王定位与将军检测 ----------------------------
        public static void FindKing(char[,] board, bool isWhite, out int r, out int c)
        {
            char k = isWhite ? 'K' : 'k';
            r = -1; c = -1;
            for (int i = 0; i < 8; ++i)
                for (int j = 0; j < 8; ++j)
                    if (board[i, j] == k) { r = i; c = j; return; }
        }

        public static bool IsInCheck(GameState state, bool isWhite)
        {
            int kr, kc;
            FindKing(state.Board, isWhite, out kr, out kc);
            if (kr < 0) return false;
            return IsAttacked(state.Board, kr, kc, !isWhite);
        }

        // ---------------------------- 终局判定 ----------------------------
        public static bool IsCheckmate(GameState state)
        {
            return IsInCheck(state, state.WhiteToMove) && GenerateAllLegalMoves(state).Count == 0;
        }

        public static bool IsStalemate(GameState state)
        {
            return !IsInCheck(state, state.WhiteToMove) && GenerateAllLegalMoves(state).Count == 0;
        }

        public static bool IsFiftyMoveDraw(GameState state)
        {
            return state.HalfmoveClock >= 100;
        }

        // 是否存在合法的吃过路兵着法（供三次重复局面键决定是否编码 ep 格）
        public static bool HasLegalEnPassant(GameState state)
        {
            if (state.EnPassantRow < 0) return false;
            int pawnRank = state.WhiteToMove ? state.EnPassantRow + 1 : state.EnPassantRow - 1;
            if (pawnRank < 0 || pawnRank > 7) return false;
            char pawn = state.WhiteToMove ? 'P' : 'p';
            for (int dc = -1; dc <= 1; dc += 2)
            {
                int c = state.EnPassantCol + dc;
                if (c < 0 || c > 7) continue;
                if (state.Board[pawnRank, c] == pawn)
                {
                    foreach (Move m in GenerateLegalMoves(state, pawnRank, c))
                        if (m.Special == SpecialMove.EnPassant) return true;
                }
            }
            return false;
        }

        public static bool IsThreefoldRepetition(GameState state)
        {
            if (state.PositionKeys.Count == 0) return false;
            string cur = state.PositionKeys[state.PositionKeys.Count - 1];
            int count = 0;
            foreach (string k in state.PositionKeys)
                if (k == cur) ++count;
            return count >= 3;
        }

        // 子力不足和棋（扩展版：KK / K+单象 / K+单马 / KNN / 异色格象组合等真实和棋）
        public static bool IsInsufficientMaterial(GameState state)
        {
            List<KeyValuePair<char, int>> white = new List<KeyValuePair<char, int>>();
            List<KeyValuePair<char, int>> black = new List<KeyValuePair<char, int>>();
            for (int r = 0; r < 8; ++r)
                for (int c = 0; c < 8; ++c)
                {
                    char p = state.Board[r, c];
                    if (p == '.' || char.ToUpperInvariant(p) == 'K') continue;
                    char up = char.ToUpperInvariant(p);
                    if (up == 'P' || up == 'R' || up == 'Q') return false;
                    if (char.IsUpper(p)) white.Add(new KeyValuePair<char, int>(p, r * 8 + c));
                    else black.Add(new KeyValuePair<char, int>(p, r * 8 + c));
                }
            int total = white.Count + black.Count;
            if (total == 0) return true;   // K vs K
            if (total == 1) return true;   // K + 单象 / 单马 vs K
            if (total == 2)
            {
                if (white.Count == 1 && black.Count == 1) return true; // 各执一子
                List<KeyValuePair<char, int>> side = (white.Count == 2) ? white : black;
                char a = char.ToUpperInvariant(side[0].Key);
                char b = char.ToUpperInvariant(side[1].Key);
                if (a == 'B' && b == 'B')
                {
                    int color0 = (side[0].Value / 8 + side[0].Value % 8) % 2;
                    int color1 = (side[1].Value / 8 + side[1].Value % 8) % 2;
                    return color0 == color1; // 同色格双象=和棋，异色格可杀
                }
                if (a == 'N' && b == 'N') return true; // 双马 vs K（和棋）
                return false;
            }
            return false;
        }
    }
}
