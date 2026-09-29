' =============================================================================
' ChessAI.vb — AI 对弈引擎（VB.NET）
' -----------------------------------------------------------------------------
' 架构（参考轻量国际象棋引擎通用方案）：
'   1. 评估层：子力价值 + 棋子-格子位置价值表 PST（Simplified Evaluation
'      标准数值：中心马加分、兵推进加分、王安全），黑方用白方表行镜像
'   2. 搜索层：negamax + alpha-beta 剪枝（无损剪枝，只提速不改决策）
'      + 走法排序（MVV-LVA：先吃大子后吃小子，大幅提升剪枝效率）
'      + 叶节点静态搜索 quiescence（只延伸吃子，避免水平线效应）
'   3. 终局评分：将死 ±9999（越快将死分越高）、逼和/子力不足 = 0
'
' 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
' 性能：搜索路径使用 GameState.CloneLight() + ApplyMove(recordHistory:=False)
' =============================================================================

Option Explicit On
Option Strict On
Option Infer On

Imports System
Imports System.Collections.Generic
Imports System.Threading
Imports ChessCore

Namespace ChessAIEngine

    Public Class AIEngine

        ' 将死基准分（须高于任意可能叶子评估，避免“贪子弃杀”；叠加深度修正：越快将死越优）
        Public Const MateScore As Integer = 900000
        ' 有界无穷大（VB Integer 取负安全，且须大于 MateScore）
        Private Const Infinity As Integer = 1000000
        ' 重复惩罚：叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过）中时，按出现
        ' 次数扣分（白方视角）。引导搜索远离重复局面，减少三重复和棋。约半兵，足以影响平手
        ' 选择而不弃子。
        Private Const RepetitionPenalty As Integer = 60

        ' ===== 子力价值（厘兵单位） =====
        Private Shared ReadOnly PieceValue As Integer() = New Integer() {0, 100, 320, 330, 500, 900, 0}
        ' 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王

        ' ===== 棋子类型索引（内部用） =====
        Private Shared Function PieceIndex(ByVal p As Char) As Integer
            Select Case Char.ToUpper(p)
                Case "P"c : Return 1
                Case "N"c : Return 2
                Case "B"c : Return 3
                Case "R"c : Return 4
                Case "Q"c : Return 5
                Case "K"c : Return 6
                Case Else : Return 0
            End Select
        End Function

        ' ===== 位置价值表 PST（白方视角，row 0 = 第 8 横线，与棋盘坐标一致） =====
        ' 经典 Simplified Evaluation 数值：鼓励兵推进、马占中心、王待底线

        Private Shared ReadOnly PST_Pawn As Integer() = New Integer() {
            0,  0,  0,  0,  0,  0,  0,  0,
           50, 50, 50, 50, 50, 50, 50, 50,
           10, 10, 20, 30, 30, 20, 10, 10,
            5,  5, 10, 25, 25, 10,  5,  5,
            0,  0,  0, 20, 20,  0,  0,  0,
            5, -5, -10,  0,  0, -10, -5,  5,
            5, 10, 10, -20, -20, 10, 10,  5,
            0,  0,  0,  0,  0,  0,  0,  0}

        Private Shared ReadOnly PST_Knight As Integer() = New Integer() {
           -50, -40, -30, -30, -30, -30, -40, -50,
           -40, -20,   0,   0,   0,   0, -20, -40,
           -30,   0,  10,  15,  15,  10,   0, -30,
           -30,   5,  15,  20,  20,  15,   5, -30,
           -30,   0,  15,  20,  20,  15,   0, -30,
           -30,   5,  10,  15,  15,  10,   5, -30,
           -40, -20,   0,   5,   5,   0, -20, -40,
           -50, -40, -30, -30, -30, -30, -40, -50}

        Private Shared ReadOnly PST_Bishop As Integer() = New Integer() {
           -20, -10, -10, -10, -10, -10, -10, -20,
           -10,   0,   0,   0,   0,   0,   0, -10,
           -10,   0,   5,  10,  10,   5,   0, -10,
           -10,   5,   5,  10,  10,   5,   5, -10,
           -10,   0,  10,  10,  10,  10,   0, -10,
           -10,  10,  10,  10,  10,  10,  10, -10,
           -10,   5,   0,   0,   0,   0,   5, -10,
           -20, -10, -10, -10, -10, -10, -10, -20}

        Private Shared ReadOnly PST_Rook As Integer() = New Integer() {
             0,   0,   0,   0,   0,   0,   0,   0,
             5,  10,  10,  10,  10,  10,  10,   5,
            -5,   0,   0,   0,   0,   0,   0,  -5,
            -5,   0,   0,   0,   0,   0,   0,  -5,
            -5,   0,   0,   0,   0,   0,   0,  -5,
            -5,   0,   0,   0,   0,   0,   0,  -5,
            -5,   0,   0,   0,   0,   0,   0,  -5,
             0,   0,   0,   5,   5,   0,   0,   0}

        Private Shared ReadOnly PST_Queen As Integer() = New Integer() {
           -20, -10, -10,  -5,  -5, -10, -10, -20,
           -10,   0,   0,   0,   0,   0,   0, -10,
           -10,   0,   5,   5,   5,   5,   0, -10,
            -5,   0,   5,   5,   5,   5,   0,  -5,
             0,   0,   5,   5,   5,   5,   0,  -5,
           -10,   5,   5,   5,   5,   5,   0, -10,
           -10,   0,   5,   0,   0,   0,   0, -10,
           -20, -10, -10,  -5,  -5, -10, -10, -20}

        Private Shared ReadOnly PST_King As Integer() = New Integer() {
           -30, -40, -40, -50, -50, -40, -40, -30,
           -30, -40, -40, -50, -50, -40, -40, -30,
           -30, -40, -40, -50, -50, -40, -40, -30,
           -30, -40, -40, -50, -50, -40, -40, -30,
           -20, -30, -30, -40, -40, -30, -30, -20,
           -10, -20, -20, -20, -20, -20, -20, -10,
            20,  20,   0,   0,   0,   0,  20,  20,
            20,  30,  10,   0,   0,  10,  30,  20}

        Private Shared Function GetPST(ByVal pieceIdx As Integer) As Integer()
            Select Case pieceIdx
                Case 1 : Return PST_Pawn
                Case 2 : Return PST_Knight
                Case 3 : Return PST_Bishop
                Case 4 : Return PST_Rook
                Case 5 : Return PST_Queen
                Case 6 : Return PST_King
                Case Else : Return Nothing
            End Select
        End Function

        ' ===== 局面评估（白方视角：正 = 白方占优） =====

        Public Shared Function Evaluate(ByVal state As GameState) As Integer
            Dim score As Integer = 0
            Dim board As Char(,) = state.Board

            For r = 0 To 7
                For c = 0 To 7
                    Dim p As Char = board(r, c)
                    If p = "."c Then Continue For

                    Dim idx As Integer = PieceIndex(p)
                    Dim pst As Integer() = GetPST(idx)
                    If pst Is Nothing Then Continue For   ' 防御：空/未知棋子不查表
                    Dim pos As Integer = r * 8 + c

                    If Char.IsUpper(p) Then
                        ' 白方：子力 + PST（表本身即白方视角）
                        score += PieceValue(idx) + pst(pos)
                    Else
                        ' 黑方：子力 + PST 行镜像（7 - r）
                        score -= PieceValue(idx) + pst((7 - r) * 8 + c)
                    End If
                Next
            Next

            ' 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
            If state.RepHistory IsNot Nothing Then
                Dim key As String = state.PositionKeySimple()
                Dim cnt As Integer = 0
                If state.RepHistory.TryGetValue(key, cnt) AndAlso cnt > 0 Then
                    score -= RepetitionPenalty * cnt
                End If
            End If

            Return score
        End Function

        ' 当前行棋方视角分数（negamax 约定）
        Private Shared Function EvaluateSide(ByVal state As GameState) As Integer
            Dim s As Integer = Evaluate(state)
            Return If(state.WhiteToMove, s, -s)
        End Function

        ' ===== 走法排序（MVV-LVA：受害者价值降序，攻击者价值升序） =====

        Private Shared Sub OrderMoves(ByVal moves As List(Of Move))
            moves.Sort(Function(a As Move, b As Move)
                           Return MoveOrderScore(b).CompareTo(MoveOrderScore(a))
                       End Function)
        End Sub

        Private Shared Function MoveOrderScore(ByVal m As Move) As Integer
            If m.Captured = "."c Then Return 0
            Dim victim As Integer = PieceValue(PieceIndex(m.Captured))
            Dim attacker As Integer = PieceValue(PieceIndex(m.Piece))
            Return victim * 10 - attacker
        End Function

        ' ===== 主搜索：negamax + alpha-beta =====

        ' 返回当前行棋方视角的分值
        Public Shared Function Negamax(ByVal state As GameState, ByVal depth As Integer,
                                       ByVal alpha As Integer, ByVal beta As Integer,
                                       ByVal ply As Integer,
                                       Optional ByVal token As CancellationToken = Nothing) As Integer
            ' 取消请求：立即中止本次搜索（由 FindBestMove 的 Try/Catch 捕获为 Nothing）
            If token.IsCancellationRequested Then Throw New OperationCanceledException()

            ' 生成当前方全部合法走法（同时可判终局）
            Dim moves As List(Of Move) = Rules.GenerateAllLegalMoves(state)

            ' 终局：无子可动
            If moves.Count = 0 Then
                If Rules.IsInCheck(state, state.WhiteToMove) Then
                    ' 被将死：离根越近（ply 越小）越差 → 返回大负数 + 深度修正
                    Return -MateScore + ply
                End If
                Return 0 ' 逼和
            End If

            ' 到达搜索深度 → 静态搜索延伸（只看吃子，消除水平线效应）
            If depth <= 0 Then
                Return Quiescence(state, alpha, beta, 0, token)
            End If

            ' 走法排序：吃子优先（提升剪枝效率）
            OrderMoves(moves)

            ' 用有界"无穷大"（避免 Integer.MinValue 取负回绕溢出）
            Dim best As Integer = -Infinity
            For Each m As Move In moves
                Dim child As GameState = state.CloneLight()
                Rules.ApplyMove(child, m, False)
                Dim score As Integer = -Negamax(child, depth - 1, -beta, -alpha, ply + 1, token)
                If score > best Then best = score
                If best > alpha Then alpha = best
                If alpha >= beta Then Exit For ' β 剪枝
            Next
            Return best
        End Function

        ' 静态搜索：只延伸吃子着法，直到局面稳定
        Private Shared Function Quiescence(ByVal state As GameState, ByVal alpha As Integer,
                                           ByVal beta As Integer, ByVal qdepth As Integer,
                                           Optional ByVal token As CancellationToken = Nothing) As Integer
            If token.IsCancellationRequested Then Throw New OperationCanceledException()

            Dim stand As Integer = EvaluateSide(state)
            If stand >= beta Then Return beta
            If stand > alpha Then alpha = stand
            If qdepth >= 4 Then Return alpha ' 静搜深度上限

            ' 只取吃子走法
            Dim captures As New List(Of Move)
            For Each m As Move In Rules.GenerateAllLegalMoves(state)
                If m.Captured <> "."c Then captures.Add(m)
            Next
            OrderMoves(captures)

            For Each m As Move In captures
                Dim child As GameState = state.CloneLight()
                Rules.ApplyMove(child, m, False)
                Dim score As Integer = -Quiescence(child, -beta, -alpha, qdepth + 1, token)
                If score >= beta Then Return beta
                If score > alpha Then alpha = score
            Next
            Return alpha
        End Function

        ' ===== 对外接口：求最佳走法 =====
        ' depth: 搜索深度（1=新手 2=中级 3=高级）
        ' 返回 Move?：无合法走法（将死/逼和）时为 Nothing

        Public Shared Function FindBestMove(ByVal state As GameState, ByVal depth As Integer,
                                            Optional ByVal token As CancellationToken = Nothing) As Move?
            Try
                Dim moves As List(Of Move) = Rules.GenerateAllLegalMoves(state)
                If moves.Count = 0 Then Return Nothing
                If moves.Count = 1 Then Return moves(0)

                OrderMoves(moves)

                Dim bestMove As Move = moves(0)
                Dim bestScore As Integer = -Infinity
                Dim alpha As Integer = -Infinity
                Dim beta As Integer = Infinity

                For Each m As Move In moves
                    ' 取消请求：在根着法循环层尽早退出，避免把已废弃局面的结果应用到棋盘
                    If token.IsCancellationRequested Then Return Nothing
                    Dim child As GameState = state.CloneLight()
                    Rules.ApplyMove(child, m, False)
                    Dim score As Integer = -Negamax(child, depth - 1, -beta, -alpha, 1, token)
                    If score > bestScore Then
                        bestScore = score
                        bestMove = m
                    End If
                    If score > alpha Then alpha = score
                Next

                Return bestMove
            Catch ex As OperationCanceledException
                ' 后台线程被新对局/悔棋/切换模式取消 → 返回 Nothing，由 UI epoch 守卫一并丢弃
                Return Nothing
            End Try
        End Function

    End Class

End Namespace
