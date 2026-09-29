' =============================================================================
' ChessCore.vb — 国际象棋核心引擎（VB.NET / .NET Framework 4.x）
' -----------------------------------------------------------------------------
' 架构（参考主流国际象棋引擎的两阶段设计）：
'   1. 数据层：GameState（棋盘 + 行棋方 + 易位权 + 过路兵目标格 + 计数器）
'   2. 规则层：Rules（伪合法走法生成 → 在副本上模拟走子 → IsAttacked 过滤）
'   3. 终局层：将军 / 将死 / 逼和 / 50 步规则 / 子力不足
'
' 棋盘表示（mailbox 方案，8x8 二维字符数组）：
'   Board(row, col)
'     row 0 = 第 8 横线（黑方底线，屏幕上方）
'     row 7 = 第 1 横线（白方底线，屏幕下方）
'   大写 = 白方棋子  K Q R B N P
'   小写 = 黑方棋子  k q r b n p
'   "."c = 空格
'
' 核心思路（引自工程实践）：
'   - IsAttacked() 单一例程支撑整个规则库（将军检测 / 易位路径安全 / 合法性过滤）
'   - 合法走法 = 伪合法走法（几何规则） - 会使己方王被攻击的走法
'     （在棋盘状态副本上模拟执行后检验，即经典"试走过滤"方案）
' =============================================================================

Option Explicit On
Option Strict On
Option Infer On

Imports System
Imports System.Collections.Generic
Imports System.Text

Namespace ChessCore

    ' ---------------------------- 特殊走法类型 ----------------------------
    Public Enum SpecialMove
        None = 0
        DoublePawn = 1       ' 兵双重进兵（设置过路兵目标格）
        EnPassant = 2        ' 吃过路兵
        CastleKingside = 3   ' 短易位（王翼易位）
        CastleQueenside = 4  ' 长易位（后翼易位）
        Promotion = 5        ' 兵升变
    End Enum

    ' ---------------------------- 走法结构 ----------------------------
    Public Structure Move
        Implements IEquatable(Of Move)
        Public FromRow As Integer
        Public FromCol As Integer
        Public ToRow As Integer
        Public ToCol As Integer
        Public Piece As Char          ' 走动的棋子
        Public Captured As Char       ' 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
        Public Special As SpecialMove
        Public Promotion As Char      ' 升变目标棋子（升变时有效）

        Public ReadOnly Property IsCapture As Boolean
            Get
                Return Captured <> "."c
            End Get
        End Property

        ' 相等性语义（供测试断言与未来散列表/置换表使用）
        Public Overloads Function Equals(ByVal other As Move) As Boolean Implements IEquatable(Of Move).Equals
            Return FromRow = other.FromRow AndAlso FromCol = other.FromCol AndAlso
                   ToRow = other.ToRow AndAlso ToCol = other.ToCol AndAlso
                   Piece = other.Piece AndAlso Special = other.Special AndAlso Promotion = other.Promotion
        End Function

        Public Overrides Function Equals(ByVal obj As Object) As Boolean
            If obj Is Nothing Then Return False
            If TypeOf obj Is Move Then Return Equals(DirectCast(obj, Move))
            Return False
        End Function

        Public Overrides Function GetHashCode() As Integer
            Return ((FromRow * 8 + FromCol) * 1000003) Xor
                   ((ToRow * 8 + ToCol) * 7919) Xor
                   Asc(Piece) Xor Asc(Promotion) Xor CInt(Special)
        End Function

        ' 长式代数记谱（无歧义，适合框架阶段；完整 SAN 歧义消解留作扩展）
        Public Overrides Function ToString() As String
            If Special = SpecialMove.CastleKingside Then Return "O-O"
            If Special = SpecialMove.CastleQueenside Then Return "O-O-O"
            Dim files As String = "abcdefgh"
            Dim fromSq As String = files(FromCol).ToString() & (8 - FromRow).ToString()
            Dim toSq As String = files(ToCol).ToString() & (8 - ToRow).ToString()
            Dim sb As New StringBuilder()
            If Char.ToUpper(Piece) = "P"c Then
                If IsCapture Then
                    sb.Append(files(FromCol)).Append("x").Append(toSq)
                Else
                    sb.Append(toSq)
                End If
                If Special = SpecialMove.Promotion Then
                    sb.Append("=").Append(Char.ToUpper(Promotion))
                End If
            Else
                sb.Append(Char.ToUpper(Piece)).Append(fromSq)
                If IsCapture Then sb.Append("x")
                sb.Append(toSq)
            End If
            Return sb.ToString()
        End Function
    End Structure

    ' ---------------------------- 对局状态 ----------------------------
    Public Class GameState
        Public Board(7, 7) As Char
        Public WhiteToMove As Boolean = True
        ' 易位权（跟踪王/车是否动过、角上车是否被吃）
        Public CanCastleWK As Boolean = True
        Public CanCastleWQ As Boolean = True
        Public CanCastleBK As Boolean = True
        Public CanCastleBQ As Boolean = True
        ' 过路兵目标格（上一步双进兵跳过的格），-1 表示无
        Public EnPassantRow As Integer = -1
        Public EnPassantCol As Integer = -1
        ' 50 步规则半步计数（吃子或动兵清零）
        Public HalfmoveClock As Integer = 0
        Public FullmoveNumber As Integer = 1
        ' 记谱历史（长式代数记谱）
        Public History As New List(Of String)
        ' 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
        Public PositionKeys As New List(Of String)
        ' 重复惩罚历史：runner 传来的本局已出现局面键（engine.mjs 兼容键），
        ' 供 Evaluate 中的重复惩罚比对。搜索不修改它，Clone/CloneLight 共享同一引用。
        Public RepHistory As Dictionary(Of String, Integer) = Nothing

        Public Sub New()
            ResetToStartPosition()
        End Sub

        Public Sub ResetToStartPosition()
            Dim back As String = "rnbqkbnr"
            For c = 0 To 7
                Board(0, c) = back(c)
                Board(1, c) = "p"c
                Board(2, c) = "."c
                Board(3, c) = "."c
                Board(4, c) = "."c
                Board(5, c) = "."c
                Board(6, c) = "P"c
                Board(7, c) = Char.ToUpper(back(c))
            Next
            WhiteToMove = True
            CanCastleWK = True : CanCastleWQ = True
            CanCastleBK = True : CanCastleBQ = True
            EnPassantRow = -1 : EnPassantCol = -1
            HalfmoveClock = 0
            FullmoveNumber = 1
            History.Clear()
            PositionKeys.Clear()
            PositionKeys.Add(GetPositionKey())
        End Sub

        ' 局面键：影响重复判定的全部状态（棋盘 64 格 + 行棋方 + 易位权 + 过路兵格）
        Public Function GetPositionKey() As String
            Dim sb As New Text.StringBuilder(84)
            For r = 0 To 7
                For c = 0 To 7
                    sb.Append(Board(r, c))
                Next
            Next
            sb.Append(If(WhiteToMove, "w"c, "b"c))
            sb.Append(If(CanCastleWK, "K"c, "-"c))
            sb.Append(If(CanCastleWQ, "Q"c, "-"c))
            sb.Append(If(CanCastleBK, "k"c, "-"c))
            sb.Append(If(CanCastleBQ, "q"c, "-"c))
            ' 仅在存在合法吃过路兵时才编码 ep 格（FEN 标准：避免无谓 ep 导致的重复判和漏判）
            If Rules.HasLegalEnPassant(Me) Then
                sb.Append(EnPassantRow.ToString()).Append(","c).Append(EnPassantCol.ToString())
            Else
                sb.Append("-1,-1")
            End If
            Return sb.ToString()
        End Function

        ' engine.mjs 兼容局面键（无 '-' 分隔的易位权、用存储值过路兵），供 runner 传来的
        ' 重复惩罚比对使用。必须与 engine.mjs 的 getPositionKey 完全一致，否则惩罚永不触发。
        Public Function PositionKeySimple() As String
            Dim sb As New Text.StringBuilder(84)
            For r = 0 To 7
                For c = 0 To 7
                    sb.Append(Board(r, c))
                Next
            Next
            sb.Append(If(WhiteToMove, "w", "b"))
            If CanCastleWK Then sb.Append("K")
            If CanCastleWQ Then sb.Append("Q")
            If CanCastleBK Then sb.Append("k")
            If CanCastleBQ Then sb.Append("q")
            If EnPassantRow >= 0 AndAlso EnPassantCol >= 0 Then
                sb.Append(EnPassantRow.ToString()).Append(","c).Append(EnPassantCol.ToString())
            Else
                sb.Append("-1,-1")
            End If
            Return sb.ToString()
        End Function

        ' 深拷贝（Char 值类型二维数组 Clone 即深拷贝）
        Public Function Clone() As GameState
            Dim s As New GameState()
            s.Board = DirectCast(Me.Board.Clone(), Char(,))
            s.WhiteToMove = Me.WhiteToMove
            s.CanCastleWK = Me.CanCastleWK
            s.CanCastleWQ = Me.CanCastleWQ
            s.CanCastleBK = Me.CanCastleBK
            s.CanCastleBQ = Me.CanCastleBQ
            s.EnPassantRow = Me.EnPassantRow
            s.EnPassantCol = Me.EnPassantCol
            s.HalfmoveClock = Me.HalfmoveClock
            s.FullmoveNumber = Me.FullmoveNumber
            s.History = New List(Of String)(Me.History)
            s.PositionKeys = New List(Of String)(Me.PositionKeys)
            s.RepHistory = Me.RepHistory ' 共享只读引用（搜索不修改）
            Return s
        End Function

        ' 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝，降低每节点开销）
        Public Function CloneLight() As GameState
            Dim s As New GameState()
            s.Board = DirectCast(Me.Board.Clone(), Char(,))
            s.WhiteToMove = Me.WhiteToMove
            s.CanCastleWK = Me.CanCastleWK
            s.CanCastleWQ = Me.CanCastleWQ
            s.CanCastleBK = Me.CanCastleBK
            s.CanCastleBQ = Me.CanCastleBQ
            s.EnPassantRow = Me.EnPassantRow
            s.EnPassantCol = Me.EnPassantCol
            s.HalfmoveClock = Me.HalfmoveClock
            s.FullmoveNumber = Me.FullmoveNumber
            s.History = Nothing
            s.PositionKeys = Nothing
            s.RepHistory = Me.RepHistory ' 共享只读引用（搜索不修改）
            Return s
        End Function
    End Class

    ' ---------------------------- 规则引擎 ----------------------------
    Public Class Rules

        ' ===== 基础工具 =====

        Public Shared Function InBoard(ByVal r As Integer, ByVal c As Integer) As Boolean
            Return r >= 0 AndAlso r <= 7 AndAlso c >= 0 AndAlso c <= 7
        End Function

        Public Shared Function IsWhitePiece(ByVal p As Char) As Boolean
            Return p <> "."c AndAlso Char.IsUpper(p)
        End Function

        Public Shared Function IsBlackPiece(ByVal p As Char) As Boolean
            Return p <> "."c AndAlso Char.IsLower(p)
        End Function

        Public Shared Function IsPieceOfSide(ByVal p As Char, ByVal white As Boolean) As Boolean
            If p = "."c Then Return False
            Return If(white, Char.IsUpper(p), Char.IsLower(p))
        End Function

        ' ===== IsAttacked：单一例程支撑整个规则库 =====
        ' 检查 (r,c) 是否被 byWhite 一方攻击（从目标格向外看，而非枚举对方全部走法）

        Public Shared Function IsAttacked(ByVal board As Char(,), ByVal r As Integer, ByVal c As Integer, ByVal byWhite As Boolean) As Boolean
            ' --- 1. 兵攻击（兵斜吃方向：白兵攻击其上方两斜格，黑兵反之） ---
            Dim pawn As Char = If(byWhite, "P"c, "p"c)
            Dim pr As Integer = If(byWhite, r + 1, r - 1)
            If pr >= 0 AndAlso pr <= 7 Then
                If c - 1 >= 0 AndAlso board(pr, c - 1) = pawn Then Return True
                If c + 1 <= 7 AndAlso board(pr, c + 1) = pawn Then Return True
            End If

            ' --- 2. 马攻击（8 个 L 形跳位） ---
            Dim knight As Char = If(byWhite, "N"c, "n"c)
            Dim dr2 As Integer() = New Integer() {-2, -2, -1, -1, 1, 1, 2, 2}
            Dim dc2 As Integer() = New Integer() {-1, 1, -2, 2, -2, 2, -1, 1}
            For i = 0 To 7
                Dim tr As Integer = r + dr2(i)
                Dim tc As Integer = c + dc2(i)
                If InBoard(tr, tc) AndAlso board(tr, tc) = knight Then Return True
            Next

            ' --- 3. 王攻击（8 邻格） ---
            Dim king As Char = If(byWhite, "K"c, "k"c)
            For dr = -1 To 1
                For dc = -1 To 1
                    If dr = 0 AndAlso dc = 0 Then Continue For
                    Dim tr As Integer = r + dr
                    Dim tc As Integer = c + dc
                    If InBoard(tr, tc) AndAlso board(tr, tc) = king Then Return True
                Next
            Next

            ' --- 4. 滑动射线攻击：直线（车/后） ---
            Dim rook As Char = If(byWhite, "R"c, "r"c)
            Dim queen As Char = If(byWhite, "Q"c, "q"c)
            Dim bishop As Char = If(byWhite, "B"c, "b"c)
            Dim dirR As Integer() = New Integer() {-1, 1, 0, 0, -1, -1, 1, 1}
            Dim dirC As Integer() = New Integer() {0, 0, -1, 1, -1, 1, -1, 1}
            ' 前 4 个方向 = 直线（车/后），后 4 个 = 斜线（象/后）
            For i = 0 To 7
                Dim tr As Integer = r + dirR(i)
                Dim tc As Integer = c + dirC(i)
                While InBoard(tr, tc)
                    Dim p As Char = board(tr, tc)
                    If p <> "."c Then
                        If i < 4 Then
                            If p = rook OrElse p = queen Then Return True
                        Else
                            If p = bishop OrElse p = queen Then Return True
                        End If
                        Exit While
                    End If
                    tr += dirR(i)
                    tc += dirC(i)
                End While
            Next

            Return False
        End Function

        ' ===== 伪合法走法生成（仅几何规则，未过滤送王） =====

        Public Shared Function GeneratePseudoMoves(ByVal state As GameState, ByVal r As Integer, ByVal c As Integer) As List(Of Move)
            Dim list As New List(Of Move)
            Dim board As Char(,) = state.Board
            Dim p As Char = board(r, c)
            If p = "."c Then Return list

            Dim isWhite As Boolean = Char.IsUpper(p)
            Dim enemyPawn As Char = If(isWhite, "p"c, "P"c)

            Select Case Char.ToUpper(p)
                Case "P"c : GeneratePawnMoves(list, state, r, c, isWhite, enemyPawn)
                Case "N"c : GenerateOffsetMoves(list, board, r, c, isWhite,
                                 New Integer() {-2, -2, -1, -1, 1, 1, 2, 2},
                                 New Integer() {-1, 1, -2, 2, -2, 2, -1, 1})
                Case "K"c
                    GenerateOffsetMoves(list, board, r, c, isWhite,
                                 New Integer() {-1, -1, -1, 0, 0, 1, 1, 1},
                                 New Integer() {-1, 0, 1, -1, 1, -1, 0, 1})
                    GenerateCastlingMoves(list, state, r, c, isWhite)
                Case "B"c : GenerateSlidingMoves(list, board, r, c, isWhite,
                                 New Integer() {-1, -1, 1, 1},
                                 New Integer() {-1, 1, -1, 1})
                Case "R"c : GenerateSlidingMoves(list, board, r, c, isWhite,
                                 New Integer() {-1, 1, 0, 0},
                                 New Integer() {0, 0, -1, 1})
                Case "Q"c : GenerateSlidingMoves(list, board, r, c, isWhite,
                                 New Integer() {-1, 1, 0, 0, -1, -1, 1, 1},
                                 New Integer() {0, 0, -1, 1, -1, 1, -1, 1})
            End Select

            Return list
        End Function

        ' 兵走法：前 1 / 起始前 2 / 斜吃 / 吃过路兵 / 升变
        Private Shared Sub GeneratePawnMoves(ByVal list As List(Of Move), ByVal state As GameState, ByVal r As Integer, ByVal c As Integer, ByVal isWhite As Boolean, ByVal enemyPawn As Char)
            Dim board As Char(,) = state.Board
            Dim dir As Integer = If(isWhite, -1, 1)
            Dim startRow As Integer = If(isWhite, 6, 1)

            ' --- 前进一格（目标格须为空） ---
            If InBoard(r + dir, c) AndAlso board(r + dir, c) = "."c Then
                AddPawnMove(list, r, c, r + dir, c, "."c, SpecialMove.None, isWhite)
                ' --- 起始位置双重进兵 ---
                If r = startRow AndAlso board(r + 2 * dir, c) = "."c Then
                    list.Add(New Move With {.FromRow = r, .FromCol = c, .ToRow = r + 2 * dir, .ToCol = c,
                                            .Piece = board(r, c), .Captured = "."c, .Special = SpecialMove.DoublePawn, .Promotion = "."c})
                End If
            End If

            ' --- 斜吃 / 吃过路兵 ---
            For Each dc As Integer In New Integer() {-1, 1}
                Dim tr As Integer = r + dir
                Dim tc As Integer = c + dc
                If Not InBoard(tr, tc) Then Continue For
                Dim target As Char = board(tr, tc)
                If target <> "."c AndAlso IsPieceOfSide(target, Not isWhite) Then
                    AddPawnMove(list, r, c, tr, tc, target, SpecialMove.None, isWhite)
                ElseIf tr = state.EnPassantRow AndAlso tc = state.EnPassantCol Then
                    ' 过路兵：目标格为空，但实际吃掉旁边的兵
                    AddPawnMove(list, r, c, tr, tc, enemyPawn, SpecialMove.EnPassant, isWhite)
                End If
            Next
        End Sub

        ' 兵走法统一入口（处理底线升变：Q/R/B/N 四种）
        Private Shared Sub AddPawnMove(ByVal list As List(Of Move), ByVal fr As Integer, ByVal fc As Integer, ByVal tr As Integer, ByVal tc As Integer, ByVal captured As Char, ByVal special As SpecialMove, ByVal isWhite As Boolean)
            If tr = 0 OrElse tr = 7 Then
                Dim promos As String = "QRBN"
                For i = 0 To 3
                    Dim promoChar As Char = If(isWhite, promos(i), Char.ToLower(promos(i)))
                    list.Add(New Move With {.FromRow = fr, .FromCol = fc, .ToRow = tr, .ToCol = tc,
                                            .Piece = If(isWhite, "P"c, "p"c), .Captured = captured,
                                            .Special = SpecialMove.Promotion, .Promotion = promoChar})
                Next
            Else
                list.Add(New Move With {.FromRow = fr, .FromCol = fc, .ToRow = tr, .ToCol = tc,
                                        .Piece = If(isWhite, "P"c, "p"c), .Captured = captured,
                                        .Special = special, .Promotion = "."c})
            End If
        End Sub

        ' 马与王的固定偏移走法（不滑动）
        Private Shared Sub GenerateOffsetMoves(ByVal list As List(Of Move), ByVal board As Char(,), ByVal r As Integer, ByVal c As Integer, ByVal isWhite As Boolean, ByVal dr As Integer(), ByVal dc As Integer())
            Dim p As Char = board(r, c)
            For i = 0 To dr.Length - 1
                Dim tr As Integer = r + dr(i)
                Dim tc As Integer = c + dc(i)
                If Not InBoard(tr, tc) Then Continue For
                Dim target As Char = board(tr, tc)
                If target = "."c OrElse IsPieceOfSide(target, Not isWhite) Then
                    list.Add(New Move With {.FromRow = r, .FromCol = c, .ToRow = tr, .ToCol = tc,
                                            .Piece = p, .Captured = target, .Special = SpecialMove.None, .Promotion = "."c})
                End If
            Next
        End Sub

        ' 象/车/后的滑动走法（射线：遇子即停，敌子可吃）
        Private Shared Sub GenerateSlidingMoves(ByVal list As List(Of Move), ByVal board As Char(,), ByVal r As Integer, ByVal c As Integer, ByVal isWhite As Boolean, ByVal dr As Integer(), ByVal dc As Integer())
            Dim p As Char = board(r, c)
            For i = 0 To dr.Length - 1
                Dim tr As Integer = r + dr(i)
                Dim tc As Integer = c + dc(i)
                While InBoard(tr, tc)
                    Dim target As Char = board(tr, tc)
                    If target = "."c Then
                        list.Add(New Move With {.FromRow = r, .FromCol = c, .ToRow = tr, .ToCol = tc,
                                                .Piece = p, .Captured = "."c, .Special = SpecialMove.None, .Promotion = "."c})
                    Else
                        If IsPieceOfSide(target, Not isWhite) Then
                            list.Add(New Move With {.FromRow = r, .FromCol = c, .ToRow = tr, .ToCol = tc,
                                                    .Piece = p, .Captured = target, .Special = SpecialMove.None, .Promotion = "."c})
                        End If
                        Exit While
                    End If
                    tr += dr(i)
                    tc += dc(i)
                End While
            Next
        End Sub

        ' 王车易位（含路径安全检查：王起始格、经过格、落点均不可被攻击）
        Private Shared Sub GenerateCastlingMoves(ByVal list As List(Of Move), ByVal state As GameState, ByVal r As Integer, ByVal c As Integer, ByVal isWhite As Boolean)
            Dim board As Char(,) = state.Board
            If isWhite Then
                If r <> 7 OrElse c <> 4 Then Return
                ' 白方短易位：K e1→g1，R h1→f1
                If state.CanCastleWK AndAlso board(7, 7) = "R"c AndAlso board(7, 5) = "."c AndAlso board(7, 6) = "."c Then
                    If Not IsAttacked(board, 7, 4, False) AndAlso Not IsAttacked(board, 7, 5, False) AndAlso Not IsAttacked(board, 7, 6, False) Then
                        list.Add(New Move With {.FromRow = 7, .FromCol = 4, .ToRow = 7, .ToCol = 6,
                                                .Piece = "K"c, .Captured = "."c, .Special = SpecialMove.CastleKingside, .Promotion = "."c})
                    End If
                End If
                ' 白方长易位：K e1→c1，R a1→d1（b1 只需为空，王不经过）
                If state.CanCastleWQ AndAlso board(7, 0) = "R"c AndAlso board(7, 1) = "."c AndAlso board(7, 2) = "."c AndAlso board(7, 3) = "."c Then
                    If Not IsAttacked(board, 7, 4, False) AndAlso Not IsAttacked(board, 7, 3, False) AndAlso Not IsAttacked(board, 7, 2, False) Then
                        list.Add(New Move With {.FromRow = 7, .FromCol = 4, .ToRow = 7, .ToCol = 2,
                                                .Piece = "K"c, .Captured = "."c, .Special = SpecialMove.CastleQueenside, .Promotion = "."c})
                    End If
                End If
            Else
                If r <> 0 OrElse c <> 4 Then Return
                ' 黑方短易位：K e8→g8，R h8→f8
                If state.CanCastleBK AndAlso board(0, 7) = "r"c AndAlso board(0, 5) = "."c AndAlso board(0, 6) = "."c Then
                    If Not IsAttacked(board, 0, 4, True) AndAlso Not IsAttacked(board, 0, 5, True) AndAlso Not IsAttacked(board, 0, 6, True) Then
                        list.Add(New Move With {.FromRow = 0, .FromCol = 4, .ToRow = 0, .ToCol = 6,
                                                .Piece = "k"c, .Captured = "."c, .Special = SpecialMove.CastleKingside, .Promotion = "."c})
                    End If
                End If
                ' 黑方长易位：K e8→c8，R a8→d8
                If state.CanCastleBQ AndAlso board(0, 0) = "r"c AndAlso board(0, 1) = "."c AndAlso board(0, 2) = "."c AndAlso board(0, 3) = "."c Then
                    If Not IsAttacked(board, 0, 4, True) AndAlso Not IsAttacked(board, 0, 3, True) AndAlso Not IsAttacked(board, 0, 2, True) Then
                        list.Add(New Move With {.FromRow = 0, .FromCol = 4, .ToRow = 0, .ToCol = 2,
                                                .Piece = "k"c, .Captured = "."c, .Special = SpecialMove.CastleQueenside, .Promotion = "."c})
                    End If
                End If
            End If
        End Sub

        ' ===== 合法走法（两阶段：模拟走子过滤送王着法） =====

        Public Shared Function GenerateLegalMoves(ByVal state As GameState, ByVal r As Integer, ByVal c As Integer) As List(Of Move)
            Dim legal As New List(Of Move)
            Dim pseudo As List(Of Move) = GeneratePseudoMoves(state, r, c)
            If pseudo.Count = 0 Then Return legal

            Dim moverIsWhite As Boolean = Char.IsUpper(pseudo(0).Piece)
            Dim kr As Integer, kc As Integer

            For Each m As Move In pseudo
                ' 在轻量副本上模拟执行，检验己方王是否被攻击
                ' （CloneLight 跳过记谱/局面键拷贝——对弈与 AI 搜索路径共同提速）
                Dim sim As GameState = state.CloneLight()
                ApplyMove(sim, m, False)
                FindKing(sim.Board, moverIsWhite, kr, kc)
                If Not IsAttacked(sim.Board, kr, kc, Not moverIsWhite) Then
                    legal.Add(m)
                End If
            Next
            Return legal
        End Function

        Public Shared Function GenerateAllLegalMoves(ByVal state As GameState) As List(Of Move)
            Dim all As New List(Of Move)
            For r = 0 To 7
                For c = 0 To 7
                    If IsPieceOfSide(state.Board(r, c), state.WhiteToMove) Then
                        all.AddRange(GenerateLegalMoves(state, r, c))
                    End If
                Next
            Next
            Return all
        End Function

        ' ===== 走子执行（增量更新状态） =====
        ' recordHistory=False 供 AI 搜索路径使用（跳过记谱与局面键，降低开销）

        Public Shared Sub ApplyMove(ByVal state As GameState, ByVal m As Move, Optional ByVal recordHistory As Boolean = True)
            Dim board As Char(,) = state.Board

            ' 1. 移动棋子本体
            board(m.ToRow, m.ToCol) = m.Piece
            board(m.FromRow, m.FromCol) = "."c

            ' 2. 特殊走法处理
            Select Case m.Special
                Case SpecialMove.DoublePawn
                    state.EnPassantRow = (m.FromRow + m.ToRow) \ 2
                    state.EnPassantCol = m.FromCol
                Case SpecialMove.EnPassant
                    ' 被吃的兵位于目标格旁边（吃子方身后一格）
                    Dim capRow As Integer = If(m.Piece = "P"c, m.ToRow + 1, m.ToRow - 1)
                    board(capRow, m.ToCol) = "."c
                Case SpecialMove.CastleKingside
                    board(m.FromRow, 5) = board(m.FromRow, 7)
                    board(m.FromRow, 7) = "."c
                Case SpecialMove.CastleQueenside
                    board(m.FromRow, 3) = board(m.FromRow, 0)
                    board(m.FromRow, 0) = "."c
                Case SpecialMove.Promotion
                    board(m.ToRow, m.ToCol) = m.Promotion
            End Select

            ' 3. 非双进兵时清除过路兵目标格
            If m.Special <> SpecialMove.DoublePawn Then
                state.EnPassantRow = -1
                state.EnPassantCol = -1
            End If

            ' 4. 更新易位权（王动过 / 车离开角格 / 角格车被吃）
            If m.Piece = "K"c Then
                state.CanCastleWK = False
                state.CanCastleWQ = False
            ElseIf m.Piece = "k"c Then
                state.CanCastleBK = False
                state.CanCastleBQ = False
            End If
            ' 白方角格 a1(7,0) / h1(7,7)
            If (m.FromRow = 7 AndAlso m.FromCol = 0) OrElse (m.ToRow = 7 AndAlso m.ToCol = 0) Then state.CanCastleWQ = False
            If (m.FromRow = 7 AndAlso m.FromCol = 7) OrElse (m.ToRow = 7 AndAlso m.ToCol = 7) Then state.CanCastleWK = False
            ' 黑方角格 a8(0,0) / h8(0,7)
            If (m.FromRow = 0 AndAlso m.FromCol = 0) OrElse (m.ToRow = 0 AndAlso m.ToCol = 0) Then state.CanCastleBQ = False
            If (m.FromRow = 0 AndAlso m.FromCol = 7) OrElse (m.ToRow = 0 AndAlso m.ToCol = 7) Then state.CanCastleBK = False

            ' 5. 50 步规则计数（动兵或吃子清零）
            If Char.ToUpper(m.Piece) = "P"c OrElse m.Captured <> "."c Then
                state.HalfmoveClock = 0
            Else
                state.HalfmoveClock += 1
            End If

            ' 6. 回合切换与记谱
            If Not state.WhiteToMove Then state.FullmoveNumber += 1
            state.WhiteToMove = Not state.WhiteToMove
            If recordHistory Then
                If state.History IsNot Nothing Then state.History.Add(m.ToString())
                If state.PositionKeys IsNot Nothing Then state.PositionKeys.Add(state.GetPositionKey())
            End If
        End Sub

        ' ===== 王定位与将军检测 =====

        Public Shared Sub FindKing(ByVal board As Char(,), ByVal isWhite As Boolean, ByRef r As Integer, ByRef c As Integer)
            Dim k As Char = If(isWhite, "K"c, "k"c)
            r = -1 : c = -1
            For i = 0 To 7
                For j = 0 To 7
                    If board(i, j) = k Then
                        r = i : c = j
                        Return
                    End If
                Next
            Next
        End Sub

        Public Shared Function IsInCheck(ByVal state As GameState, ByVal isWhite As Boolean) As Boolean
            Dim kr As Integer, kc As Integer
            FindKing(state.Board, isWhite, kr, kc)
            If kr < 0 Then Return False ' 无王（测试局面容错）
            Return IsAttacked(state.Board, kr, kc, Not isWhite)
        End Function

        ' ===== 终局判定 =====

        Public Shared Function IsCheckmate(ByVal state As GameState) As Boolean
            Return IsInCheck(state, state.WhiteToMove) AndAlso GenerateAllLegalMoves(state).Count = 0
        End Function

        Public Shared Function IsStalemate(ByVal state As GameState) As Boolean
            Return Not IsInCheck(state, state.WhiteToMove) AndAlso GenerateAllLegalMoves(state).Count = 0
        End Function

        ' 50 步规则：连续 50 回合（100 半步）无吃子、无动兵
        Public Shared Function IsFiftyMoveDraw(ByVal state As GameState) As Boolean
            Return state.HalfmoveClock >= 100
        End Function

        ' 是否存在合法的吃过路兵着法（供三次重复局面键决定是否编码 ep 格）
        Public Shared Function HasLegalEnPassant(ByVal state As GameState) As Boolean
            If state.EnPassantRow < 0 Then Return False
            ' 可吃方 = 当前行棋方；其兵位于 ep 目标格同排（EnPassantRow）的左右相邻格
            Dim pawnRank As Integer = If(state.WhiteToMove, state.EnPassantRow + 1, state.EnPassantRow - 1)
            If pawnRank < 0 OrElse pawnRank > 7 Then Return False
            Dim pawn As Char = If(state.WhiteToMove, "P"c, "p"c)
            For dc As Integer = -1 To 1 Step 2
                Dim c As Integer = state.EnPassantCol + dc
                If c < 0 OrElse c > 7 Then Continue For
                If state.Board(pawnRank, c) = pawn Then
                    For Each m As Move In GenerateLegalMoves(state, pawnRank, c)
                        If m.Special = SpecialMove.EnPassant Then Return True
                    Next
                End If
            Next
            Return False
        End Function

        ' 三次重复局面判和：当前局面键在历史中出现过 3 次
        Public Shared Function IsThreefoldRepetition(ByVal state As GameState) As Boolean
            If state.PositionKeys Is Nothing OrElse state.PositionKeys.Count = 0 Then Return False
            Dim currentKey As String = state.PositionKeys(state.PositionKeys.Count - 1)
            Dim count As Integer = 0
            For Each k As String In state.PositionKeys
                If k = currentKey Then count += 1
            Next
            Return count >= 3
        End Function

        ' 子力不足和棋（扩展版：KK / K+单象 / K+单马 / KNN / 异色格象组合等真实和棋）
        ' 含兵/车/后则一定可杀（不判和）；其余按残局可杀性判定。
        Public Shared Function IsInsufficientMaterial(ByVal state As GameState) As Boolean
            Dim white As New List(Of Tuple(Of Char, Integer, Integer))()
            Dim black As New List(Of Tuple(Of Char, Integer, Integer))()
            For r = 0 To 7
                For c = 0 To 7
                    Dim p As Char = state.Board(r, c)
                    If p = "."c OrElse Char.ToUpper(p) = "K"c Then Continue For
                    Dim up As Char = Char.ToUpper(p)
                    If up = "P"c OrElse up = "R"c OrElse up = "Q"c Then Return False
                    If Char.IsUpper(p) Then white.Add(Tuple.Create(p, r, c)) Else black.Add(Tuple.Create(p, r, c))
                Next
            Next

            Dim total As Integer = white.Count + black.Count
            If total = 0 Then Return True          ' K vs K
            If total = 1 Then Return True          ' K + 单象 / 单马 vs K
            If total = 2 Then
                ' 各执一子（如 KB vs KB / KN vs KN）→ 任一方皆无法逼和
                If white.Count = 1 AndAlso black.Count = 1 Then Return True
                ' 一侧拥有两枚次子
                Dim side As List(Of Tuple(Of Char, Integer, Integer)) = If(white.Count = 2, white, black)
                Dim a As Char = Char.ToUpper(side(0).Item1)
                Dim b As Char = Char.ToUpper(side(1).Item1)
                If a = "B"c AndAlso b = "B"c Then
                    ' 双象：同色格双象无法逼和（和棋）；异色格双象可杀（不判和）
                    Dim color0 As Integer = (side(0).Item2 + side(0).Item3) Mod 2
                    Dim color1 As Integer = (side(1).Item2 + side(1).Item3) Mod 2
                    If color0 = color1 Then Return True
                    Return False
                End If
                If a = "N"c AndAlso b = "N"c Then Return True   ' 双马 vs K（和棋）
                Return False                              ' 马+象同侧可杀（不判和）
            End If
            Return False
        End Function

    End Class

End Namespace
