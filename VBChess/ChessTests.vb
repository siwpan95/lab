' =============================================================================
' ChessTests.vb — 核心规则自测（控制台）
' -----------------------------------------------------------------------------
' 覆盖：初始走法数 / 过路兵 / 王车易位 / 升变 / 将死（学者杀、愚兄杀）/
'       逼和 / 子力不足 / 50 步计数 / IsAttacked 基础语义
' 断言值均取自国际象棋公认结论（如初始局面白方合法走法恒为 20）
' =============================================================================

Option Explicit On

Imports System.Collections.Generic
Imports ChessCore

Module ChessTests

    Private passCount As Integer = 0
    Private failCount As Integer = 0

    Sub Main()
        TestInitialPosition()
        TestIsAttackedBasics()
        TestPawnDoubleAndEnPassant()
        TestCastling()
        TestPromotion()
        TestScholarMate()
        TestFoolMate()
        TestStalemate()
        TestInsufficientMaterial()
        TestFiftyMoveCounter()
        TestThreefoldRepetition()
        TestEvaluation()
        TestNegamaxTerminalScores()
        TestAIFindsMate()
        TestAICapturesFreeQueen()
        TestAIChooseReasonableOpening()
        ' ---- gstack 审查补强测试（P1#3 + P2#14）----
        TestPinnedPiece()
        TestCheckEvasion()
        TestEnPassantRevealCheck()
        TestInsufficientMaterialExtended()
        TestDepth3Timing()
        TestCastlingRightRevokedOnRookCapture()
        TestDegeneratePositions()
        TestPromotionSAN()

        Console.WriteLine()
        Console.WriteLine("========================================")
        Console.WriteLine(String.Format("RESULT: {0} passed, {1} failed", passCount, failCount))
        Console.WriteLine("========================================")
        If failCount > 0 Then
            Environment.Exit(1)
        End If
    End Sub

    ' ---------- 断言工具 ----------
    Private Sub Check(ByVal name As String, ByVal cond As Boolean)
        If cond Then
            passCount += 1
            Console.WriteLine("[PASS] " & name)
        Else
            failCount += 1
            Console.WriteLine("[FAIL] " & name)
        End If
    End Sub

    ' 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
    Private Function FindMove(ByVal state As GameState, ByVal r As Integer, ByVal c As Integer, ByVal tr As Integer, ByVal tc As Integer) As Move
        For Each m As Move In Rules.GenerateLegalMoves(state, r, c)
            If m.ToRow = tr AndAlso m.ToCol = tc Then Return m
        Next
        Throw New Exception(String.Format("move not found: ({0},{1})->({2},{3})", r, c, tr, tc))
    End Function

    ' 走一步并返回新状态
    Private Function Play(ByVal state As GameState, ByVal r As Integer, ByVal c As Integer, ByVal tr As Integer, ByVal tc As Integer) As GameState
        Dim m As Move = FindMove(state, r, c, tr, tc)
        Dim s As GameState = state.Clone()
        Rules.ApplyMove(s, m)
        Return s
    End Function

    ' ---------- 1. 初始局面 ----------
    Private Sub TestInitialPosition()
        Dim s As New GameState()

        Check("初始局面白方合法走法数 = 20", Rules.GenerateAllLegalMoves(s).Count = 20)
        Check("初始局面 b1 马走法数 = 2", Rules.GenerateLegalMoves(s, 7, 1).Count = 2)
        Check("初始局面 g1 马走法数 = 2", Rules.GenerateLegalMoves(s, 7, 6).Count = 2)
        Check("初始局面 e2 兵走法数 = 2", Rules.GenerateLegalMoves(s, 6, 4).Count = 2)
        Check("初始局面 d1 后走法数 = 0", Rules.GenerateLegalMoves(s, 7, 3).Count = 0)
        Check("初始局面白王不被将军", Not Rules.IsInCheck(s, True))
        Check("初始局面黑王不被将军", Not Rules.IsInCheck(s, False))
        Check("初始局面非将死", Not Rules.IsCheckmate(s))

        ' 黑方对称
        Dim b As New GameState()
        b.WhiteToMove = False
        Check("初始局面黑方合法走法数 = 20", Rules.GenerateAllLegalMoves(b).Count = 20)
    End Sub

    ' ---------- 2. IsAttacked 基础语义 ----------
    Private Sub TestIsAttackedBasics()
        ' 构造局面：白兵 e4、黑兵 e5（兵已就位），双方王远离攻击区
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(4, 4) = "P"c        ' 白兵 e4
        s.Board(3, 4) = "p"c        ' 黑兵 e5
        s.Board(7, 4) = "K"c        ' 白王 e1
        s.Board(0, 4) = "k"c        ' 黑王 e8

        ' 白兵 e4(4,4)：攻击 d5(3,3) 与 f5(3,5)，不攻击正前方 e5(3,4)
        Check("白兵 e4 攻击 d5", Rules.IsAttacked(s.Board, 3, 3, True))
        Check("白兵 e4 攻击 f5", Rules.IsAttacked(s.Board, 3, 5, True))
        Check("白兵 e4 不攻击 e5（兵不直吃）", Not Rules.IsAttacked(s.Board, 3, 4, True))
        ' 黑兵 e5(3,4)：攻击 d4(4,3) 与 f4(4,5)
        Check("黑兵 e5 攻击 d4", Rules.IsAttacked(s.Board, 4, 3, False))
        Check("黑兵 e5 攻击 f4", Rules.IsAttacked(s.Board, 4, 5, False))
        ' 无人攻击的空格
        Check("a1 格不被任何方攻击", Not Rules.IsAttacked(s.Board, 7, 0, True) AndAlso Not Rules.IsAttacked(s.Board, 7, 0, False))
        ' 王攻击邻格：白王 e1 攻击 e2
        Check("白王 e1 攻击 e2", Rules.IsAttacked(s.Board, 6, 4, True))
    End Sub

    ' ---------- 3. 双进兵与吃过路兵 ----------
    Private Sub TestPawnDoubleAndEnPassant()
        ' 双进兵设置过路兵目标格
        Dim s As New GameState()
        s = Play(s, 6, 4, 4, 4)  ' 1. e2-e4
        Check("e4 双进兵设置过路兵格 (5,4)", s.EnPassantRow = 5 AndAlso s.EnPassantCol = 4)
        Check("双进兵后半步计数 = 0", s.HalfmoveClock = 0)
        Check("e4 后轮黑方", Not s.WhiteToMove)

        ' 黑方双进兵 d7-d5，白 e5 兵可吃过路兵
        Dim t As New GameState()
        t.Board(3, 4) = "P"c        ' 白兵 e5
        t.Board(1, 3) = "p"c        ' 黑兵 d7（将双走进 d5）
        t.WhiteToMove = False
        t.EnPassantRow = -1 : t.EnPassantCol = -1
        t = Play(t, 1, 3, 3, 3)     ' 黑 d7-d5 → 过路兵格 = d6(2,3)
        Check("黑 d5 双进后轮白方", t.WhiteToMove)

        Dim pawnMoves As List(Of Move) = Rules.GenerateLegalMoves(t, 3, 4)
        Dim epMove As Move = Nothing
        For Each m As Move In pawnMoves
            If m.Special = SpecialMove.EnPassant Then epMove = m
        Next
        Check("白 e5 兵存在吃过路兵走法", Not epMove.Equals(Nothing))

        ' 执行过路兵吃：e5xd6 → 白兵到 d6(2,3)，黑 d5 兵(3,3)被移除
        Dim after As GameState = t.Clone()
        Rules.ApplyMove(after, epMove)
        Check("过路兵吃后白兵位于 d6", after.Board(2, 3) = "P"c)
        Check("过路兵吃后黑 d5 兵被移除", after.Board(3, 3) = "."c)
        Check("过路兵吃后过路兵格已清空", after.EnPassantRow = -1)
    End Sub

    ' ---------- 4. 王车易位 ----------
    Private Sub TestCastling()
        ' 构造：白 K e1，白 R h1 / a1，清空 f1/g1 与 b1/c1/d1
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 4) = "K"c : s.Board(7, 7) = "R"c : s.Board(7, 0) = "R"c
        s.Board(0, 4) = "k"c

        Dim kingMoves As List(Of Move) = Rules.GenerateLegalMoves(s, 7, 4)
        Dim castleK As Boolean = False, castleQ As Boolean = False
        For Each m As Move In kingMoves
            If m.Special = SpecialMove.CastleKingside Then castleK = True
            If m.Special = SpecialMove.CastleQueenside Then castleQ = True
        Next
        Check("白王可短易位", castleK)
        Check("白王可长易位", castleQ)

        ' 执行短易位：K→g1, R→f1
        Dim after As GameState = s.Clone()
        Dim mv As Move = Nothing
        For Each m As Move In Rules.GenerateLegalMoves(s, 7, 4)
            If m.Special = SpecialMove.CastleKingside Then mv = m
        Next
        Rules.ApplyMove(after, mv)
        Check("短易位后白王位于 g1", after.Board(7, 6) = "K"c)
        Check("短易位后白车位于 f1", after.Board(7, 5) = "R"c)
        Check("短易位后 h1 为空", after.Board(7, 7) = "."c)
        Check("短易位后白方失去全部易位权", Not after.CanCastleWK AndAlso Not after.CanCastleWQ)

        ' 路径被攻击时禁止易位：黑车放 d5 攻击 d1 → 长易位禁止
        Dim blocked As GameState = s.Clone()
        blocked.Board(3, 3) = "r"c    ' 黑车 d5，d 线畅通攻击 d1
        Dim km As List(Of Move) = Rules.GenerateLegalMoves(blocked, 7, 4)
        Dim castleQBlocked As Boolean = False
        For Each m As Move In km
            If m.Special = SpecialMove.CastleQueenside Then castleQBlocked = True
        Next
        Check("路径 d1 被攻击时长易位被禁止", Not castleQBlocked)

        ' 王被将军时禁止易位：黑车 e 线攻击 e1
        Dim inCheck As GameState = s.Clone()
        inCheck.Board(3, 4) = "r"c    ' 黑车 e5 攻击 e1
        km = Rules.GenerateLegalMoves(inCheck, 7, 4)
        Dim anyCastle As Boolean = False
        For Each m As Move In km
            If m.Special = SpecialMove.CastleKingside OrElse m.Special = SpecialMove.CastleQueenside Then anyCastle = True
        Next
        Check("王被将军时禁止易位", Not anyCastle)
    End Sub

    ' ---------- 5. 兵升变 ----------
    Private Sub TestPromotion()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(1, 4) = "P"c          ' 白兵 e7
        s.Board(7, 4) = "K"c
        s.Board(0, 7) = "k"c

        Dim moves As List(Of Move) = Rules.GenerateLegalMoves(s, 1, 4)
        Dim promoCount As Integer = 0
        For Each m As Move In moves
            If m.Special = SpecialMove.Promotion Then promoCount += 1
        Next
        Check("e7 兵生成 4 种升变走法（Q/R/B/N）", promoCount = 4)

        ' 执行升后
        Dim after As GameState = s.Clone()
        Dim mv As Move = Nothing
        For Each m As Move In Rules.GenerateLegalMoves(s, 1, 4)
            If m.Special = SpecialMove.Promotion AndAlso m.Promotion = "Q"c Then mv = m
        Next
        Rules.ApplyMove(after, mv)
        Check("升变后 e8 为白后", after.Board(0, 4) = "Q"c)
        Check("升变后 e7 为空", after.Board(1, 4) = "."c)
    End Sub

    ' ---------- 6. 学者将杀 ----------
    ' 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
    Private Sub TestScholarMate()
        Dim s As New GameState()
        s = Play(s, 6, 4, 4, 4)   ' 1. e4
        s = Play(s, 1, 4, 3, 4)   ' 1... e5
        s = Play(s, 7, 5, 4, 2)   ' 2. Bf1-c4
        s = Play(s, 0, 1, 2, 2)   ' 2... Nb8-c6
        s = Play(s, 7, 3, 3, 7)   ' 3. Qd1-h5
        s = Play(s, 0, 6, 2, 5)   ' 3... Ng8-f6
        s = Play(s, 3, 7, 1, 5)   ' 4. Qh5xf7#

        Check("学者将杀：黑方被将军", Rules.IsInCheck(s, False))
        Check("学者将杀：IsCheckmate = True", Rules.IsCheckmate(s))
        Check("学者将杀：非逼和", Not Rules.IsStalemate(s))
        Check("学者将杀后轮黑方", Not s.WhiteToMove)
    End Sub

    ' ---------- 7. 愚兄杀 ----------
    ' 1.f3 e5 2.g4 Qh4#
    Private Sub TestFoolMate()
        Dim s As New GameState()
        s = Play(s, 6, 5, 5, 5)   ' 1. f3
        s = Play(s, 1, 4, 3, 4)   ' 1... e5
        s = Play(s, 6, 6, 4, 6)   ' 2. g4
        s = Play(s, 0, 3, 4, 7)   ' 2... Qd8-h4#

        Check("愚兄杀：白方被将军", Rules.IsInCheck(s, True))
        Check("愚兄杀：IsCheckmate = True", Rules.IsCheckmate(s))
    End Sub

    ' ---------- 8. 逼和 ----------
    ' 黑王 h8，白后 f7，白王 g6，轮黑：黑无子可动且未被将军
    Private Sub TestStalemate()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(0, 7) = "k"c      ' 黑王 h8
        s.Board(1, 5) = "Q"c      ' 白后 f7
        s.Board(2, 6) = "K"c      ' 白王 g6
        s.WhiteToMove = False

        Check("逼和局面：黑方不被将军", Not Rules.IsInCheck(s, False))
        Check("逼和局面：黑方合法走法数 = 0", Rules.GenerateAllLegalMoves(s).Count = 0)
        Check("逼和局面：IsStalemate = True", Rules.IsStalemate(s))
        Check("逼和局面：非将死", Not Rules.IsCheckmate(s))
    End Sub

    ' ---------- 9. 子力不足 ----------
    Private Sub TestInsufficientMaterial()
        Dim kk As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kk.Board(r, c) = "."c
            Next
        Next
        kk.Board(7, 4) = "K"c : kk.Board(0, 4) = "k"c
        Check("仅剩双王 = 子力不足", Rules.IsInsufficientMaterial(kk))

        kk.Board(4, 4) = "N"c
        Check("王+单马 vs 王 = 子力不足", Rules.IsInsufficientMaterial(kk))

        kk.Board(4, 4) = "b"c
        Check("王+单象 vs 王 = 子力不足", Rules.IsInsufficientMaterial(kk))

        kk.Board(4, 4) = "P"c
        Check("王+兵 vs 王 ≠ 子力不足", Not Rules.IsInsufficientMaterial(kk))

        kk.Board(4, 4) = "R"c
        Check("王+车 vs 王 ≠ 子力不足", Not Rules.IsInsufficientMaterial(kk))

        Dim full As New GameState()
        Check("初始局面 ≠ 子力不足", Not Rules.IsInsufficientMaterial(full))
    End Sub

    ' ---------- 10. 50 步规则计数 ----------
    Private Sub TestFiftyMoveCounter()
        Dim s As New GameState()
        s = Play(s, 7, 6, 5, 5)   ' 1. Ng1-f3
        Check("马走一步后半步计数 = 1", s.HalfmoveClock = 1)
        s = Play(s, 0, 6, 2, 5)   ' 1... Ng8-f6
        Check("两步非兵非吃后半步计数 = 2", s.HalfmoveClock = 2)
        s = Play(s, 5, 5, 7, 6)   ' 2. Nf3-g1
        Check("三步后半步计数 = 3", s.HalfmoveClock = 3)
        s = Play(s, 2, 5, 0, 6)   ' 2... Nf6-g8
        Check("四步后半步计数 = 4", s.HalfmoveClock = 4)
        s = Play(s, 6, 4, 4, 4)   ' 3. e4（动兵清零）
        Check("动兵后半步计数清零", s.HalfmoveClock = 0)
        Check("未达 100 半步不判 50 步和棋", Not Rules.IsFiftyMoveDraw(s))

        Dim forced As New GameState()
        forced.HalfmoveClock = 100
        Check("100 半步判 50 步和棋", Rules.IsFiftyMoveDraw(forced))
    End Sub

    ' ---------- 11. 三次重复局面判和 ----------
    Private Sub TestThreefoldRepetition()
        Dim s As New GameState()

        ' 第一轮：马往返（4 步后回到初始局面 → 出现第 2 次）
        s = Play(s, 7, 6, 5, 5)   ' 1. Ng1-f3
        s = Play(s, 0, 6, 2, 5)   ' 1... Ng8-f6
        s = Play(s, 5, 5, 7, 6)   ' 2. Nf3-g1
        s = Play(s, 2, 5, 0, 6)   ' 2... Nf6-g8
        Check("4 步往返后局面重复第 2 次（不判和）", Not Rules.IsThreefoldRepetition(s))

        ' 第二轮：再来 4 步 → 出现第 3 次 → 判和
        s = Play(s, 7, 6, 5, 5)
        s = Play(s, 0, 6, 2, 5)
        s = Play(s, 5, 5, 7, 6)
        s = Play(s, 2, 5, 0, 6)
        Check("8 步往返后局面重复第 3 次（判和）", Rules.IsThreefoldRepetition(s))

        ' 走一个此前未出现过的局面（e4）→ 不再构成 3 次重复
        ' （注：若再走 Ng1-f3，其局面等于第一轮同局面，仍会构成第 3 次重复——规则语义正确）
        s = Play(s, 6, 4, 4, 4)
        Check("走出新局面后不再判和", Not Rules.IsThreefoldRepetition(s))
    End Sub

    ' ---------- 12. 评估函数 ----------
    Private Sub TestEvaluation()
        Dim s As New GameState()
        Check("初始局面评估 = 0（对称）", ChessAIEngine.AIEngine.Evaluate(s) = 0)

        ' 白方多一兵 → 正分
        s.Board(4, 4) = "P"c
        Dim score1 As Integer = ChessAIEngine.AIEngine.Evaluate(s)
        Check("白方多一兵 → 评估为正", score1 > 0)

        ' 再让黑方多一马 → 负分（马 320 > 兵 100）
        s.Board(3, 3) = "n"c
        Dim score2 As Integer = ChessAIEngine.AIEngine.Evaluate(s)
        Check("黑方多一马压过白方一兵 → 评估为负", score2 < 0)
    End Sub

    ' ---------- 13. Negamax 终局评分 ----------
    Private Sub TestNegamaxTerminalScores()
        ' 学者将杀最终局面：轮黑且被将死 → 返回大负数
        Dim s As New GameState()
        s = Play(s, 6, 4, 4, 4) : s = Play(s, 1, 4, 3, 4)
        s = Play(s, 7, 5, 4, 2) : s = Play(s, 0, 1, 2, 2)
        s = Play(s, 7, 3, 3, 7) : s = Play(s, 0, 6, 2, 5)
        s = Play(s, 3, 7, 1, 5)   ' 4. Qxf7#
        Dim mateScore As Integer = ChessAIEngine.AIEngine.Negamax(s, 2, -1000000, 1000000, 0)
        Check("将死局面 negamax 返回大负数", mateScore <= -9000)

        ' 逼和局面 → 0
        Dim st As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                st.Board(r, c) = "."c
            Next
        Next
        st.Board(0, 7) = "k"c : st.Board(1, 5) = "Q"c : st.Board(2, 6) = "K"c
        st.WhiteToMove = False
        st.PositionKeys.Clear()
        st.PositionKeys.Add(st.GetPositionKey())
        Dim staleScore As Integer = ChessAIEngine.AIEngine.Negamax(st, 2, -1000000, 1000000, 0)
        Check("逼和局面 negamax 返回 0", staleScore = 0)
    End Sub

    ' ---------- 14. AI 一步杀 ----------
    Private Sub TestAIFindsMate()
        ' 构造标准 KQK 杀局：白王 b6 封锁逃跑格，白后 h1 → Qh8# 一步杀
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(2, 1) = "K"c      ' 白王 b6（控制 a7/b7）
        s.Board(7, 7) = "Q"c      ' 白后 h1（h 线畅通 → h8）
        s.Board(0, 0) = "k"c      ' 黑王 a8
        s.WhiteToMove = True
        s.PositionKeys.Clear() : s.PositionKeys.Add(s.GetPositionKey())

        Dim best As Move = ChessAIEngine.AIEngine.FindBestMove(s, 2)
        Dim after As GameState = s.Clone()
        Rules.ApplyMove(after, best, False)
        Check("AI 深度 2 找到一步杀（Qh8#）", Rules.IsCheckmate(after))
    End Sub

    ' ---------- 15. AI 白吃无保护后 ----------
    Private Sub TestAICapturesFreeQueen()
        ' 构造：白后 d1，黑后 d8（d 线畅通），黑王 h8 不保护 d8，白王 e1
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 3) = "Q"c      ' 白后 d1
        s.Board(7, 4) = "K"c      ' 白王 e1
        s.Board(0, 3) = "q"c      ' 黑后 d8
        s.Board(0, 7) = "k"c      ' 黑王 h8
        s.WhiteToMove = True
        s.PositionKeys.Clear() : s.PositionKeys.Add(s.GetPositionKey())

        Dim best As Move = ChessAIEngine.AIEngine.FindBestMove(s, 2)
        Check("AI 深度 2 捕获无保护黑后", best.ToRow = 0 AndAlso best.ToCol = 3 AndAlso best.Captured = "q"c)
    End Sub

    ' ---------- 16. AI 开局合理性 ----------
    Private Sub TestAIChooseReasonableOpening()
        ' 初始局面 AI 深度 2 应返回合法走法（且耗时在交互级别）
        Dim s As New GameState()
        Dim sw As New System.Diagnostics.Stopwatch()
        sw.Start()
        Dim best As Move = ChessAIEngine.AIEngine.FindBestMove(s, 2)
        sw.Stop()

        Dim isLegal As Boolean = False
        For Each m As Move In Rules.GenerateAllLegalMoves(s)
            If m.FromRow = best.FromRow AndAlso m.FromCol = best.FromCol AndAlso
               m.ToRow = best.ToRow AndAlso m.ToCol = best.ToCol Then isLegal = True
        Next
        Check("初始局面 AI 返回合法走法", isLegal)
        Check("AI 深度 2 初始局面搜索 < 5 秒", sw.ElapsedMilliseconds < 5000)
    End Sub

    ' ---------- 17. 被钉死棋子限制（gstack P1#3）----------
    ' 白王 d1，白象 d2，黑车 d8：象被钉死在 d 线，离开即被将军 → 零合法走法
    Private Sub TestPinnedPiece()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 3) = "K"c      ' 白王 d1
        s.Board(6, 3) = "B"c      ' 白象 d2
        s.Board(0, 3) = "r"c      ' 黑车 d8（沿 d 线攻击）
        s.Board(0, 4) = "k"c      ' 黑王 e8

        Check("钉死前象存在伪合法走法", Rules.GeneratePseudoMoves(s, 6, 3).Count > 0)
        Check("被钉死象无合法走法", Rules.GenerateLegalMoves(s, 6, 3).Count = 0)
        Check("钉死局面白王未被将军", Not Rules.IsInCheck(s, True))
    End Sub

    ' ---------- 18. 被将军时合法走法枚举（gstack P1#3）----------
    ' 白王 e1，黑车 e8（e 线畅通）：白被将军，所有合法走法必须解除将军
    Private Sub TestCheckEvasion()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 4) = "K"c      ' 白王 e1
        s.Board(0, 4) = "r"c      ' 黑车 e8
        s.Board(0, 0) = "k"c      ' 黑王 a8

        Check("逃将局面白王被将军", Rules.IsInCheck(s, True))
        Dim legal As List(Of Move) = Rules.GenerateAllLegalMoves(s)
        Check("被将军时合法走法均为逃着（>0）", legal.Count > 0)
        ' 验证每一个合法走法执行后白王不再被将军
        Dim allResolve As Boolean = True
        For Each m As Move In legal
            Dim after As GameState = s.Clone()
            Rules.ApplyMove(after, m)
            If Rules.IsInCheck(after, True) Then allResolve = False
        Next
        Check("每个合法走法均解除将军", allResolve)
    End Sub

    ' ---------- 19. 过路兵吃子揭开己方王（gstack P1#3）----------
    ' 白王 a5，黑车 h5（同第 5 横线），白兵 d5，黑兵 e5（刚双进）
    ' 若白 d5 吃过路兵(e5xd6) 会移走 e5 兵，使黑车沿第 5 横线将军白王 → 该吃子非法
    Private Sub TestEnPassantRevealCheck()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(3, 0) = "K"c      ' 白王 a5
        s.Board(3, 7) = "r"c      ' 黑车 h5
        s.Board(3, 3) = "P"c      ' 白兵 d5
        s.Board(3, 4) = "p"c      ' 黑兵 e5（e7-e5 双进）
        s.WhiteToMove = True
        s.EnPassantRow = 2        ' ep 目标 = d6 所在行（e5 跳过的格）
        s.EnPassantCol = 4
        s.PositionKeys.Clear()

        Check("EP 揭开将军：当前白王未被将军", Not Rules.IsInCheck(s, True))
        Dim legal As List(Of Move) = Rules.GenerateLegalMoves(s, 3, 3)
        Dim hasEP As Boolean = False
        For Each m As Move In legal
            If m.Special = SpecialMove.EnPassant Then hasEP = True
        Next
        Check("EP 吃子会揭开己方王 → 不出现在合法走法中", Not hasEP)
    End Sub

    ' ---------- 20. 子力不足扩展（gstack P1#6）----------
    Private Sub TestInsufficientMaterialExtended()
        ' K vs K
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 4) = "K"c : s.Board(0, 4) = "k"c
        Check("KK = 子力不足", Rules.IsInsufficientMaterial(s))

        ' KN vs K
        s.Board(7, 1) = "N"c
        Check("KN vs K = 子力不足", Rules.IsInsufficientMaterial(s))

        ' KNN vs K（双马和棋）
        s.Board(7, 2) = "N"c
        Check("KNN vs K = 子力不足", Rules.IsInsufficientMaterial(s))

        ' KB vs KB（异色格单象，各一子 → 和棋）
        Dim kb As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kb.Board(r, c) = "."c
            Next
        Next
        kb.Board(7, 4) = "K"c : kb.Board(0, 4) = "k"c
        kb.Board(7, 2) = "B"c      ' 白象 c1（(7+2)=9 奇）
        kb.Board(0, 3) = "b"c      ' 黑象 d8（(0+3)=3 奇）
        Check("KB vs KB = 子力不足", Rules.IsInsufficientMaterial(kb))

        ' KBB 同侧异色格双象（可杀 → 不判和）
        Dim kbb As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kbb.Board(r, c) = "."c
            Next
        Next
        kbb.Board(7, 4) = "K"c : kbb.Board(0, 4) = "k"c
        kbb.Board(7, 2) = "B"c      ' 白象 c1（奇）
        kbb.Board(7, 5) = "B"c      ' 白象 f1（(7+5)=12 偶，异色）
        Check("KBB 异色格双象可杀 ≠ 子力不足", Not Rules.IsInsufficientMaterial(kbb))

        ' KBN vs K（马+象可杀 → 不判和）
        Dim kbn As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kbn.Board(r, c) = "."c
            Next
        Next
        kbn.Board(7, 4) = "K"c : kbn.Board(0, 4) = "k"c
        kbn.Board(7, 2) = "B"c : kbn.Board(7, 1) = "N"c
        Check("KBN vs K 可杀 ≠ 子力不足", Not Rules.IsInsufficientMaterial(kbn))

        ' K + 车 vs K（车可杀 → 不判和）
        Dim kr As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kr.Board(r, c) = "."c
            Next
        Next
        kr.Board(7, 4) = "K"c : kr.Board(0, 4) = "k"c : kr.Board(7, 0) = "R"c
        Check("K + 车 vs K 可杀 ≠ 子力不足", Not Rules.IsInsufficientMaterial(kr))
    End Sub

    ' ---------- 21. AI 深度 3 性能（gstack P1#7）----------
    Private Sub TestDepth3Timing()
        Dim s As New GameState()
        s = Play(s, 6, 4, 4, 4)   ' 1. e4
        s = Play(s, 1, 4, 3, 4)   ' 1... e5
        s = Play(s, 7, 6, 5, 5)   ' 2. Nf3
        s = Play(s, 0, 1, 2, 2)   ' 2... Nc6
        s = Play(s, 7, 5, 4, 2)   ' 3. Bc4
        s = Play(s, 0, 6, 2, 5)   ' 3... Nf6

        Dim sw As New System.Diagnostics.Stopwatch()
        sw.Start()
        Dim best As Move? = ChessAIEngine.AIEngine.FindBestMove(s, 3)
        sw.Stop()

        Dim isLegal As Boolean = False
        If best.HasValue Then
            For Each m As Move In Rules.GenerateAllLegalMoves(s)
                If m.FromRow = best.Value.FromRow AndAlso m.FromCol = best.Value.FromCol AndAlso
                   m.ToRow = best.Value.ToRow AndAlso m.ToCol = best.Value.ToCol Then isLegal = True
            Next
        End If
        Check("AI 深度 3 返回合法走法", isLegal)
        Check("AI 深度 3 中局搜索 < 2 秒", sw.ElapsedMilliseconds < 2000)
    End Sub

    ' ---------- 22. 角格车被吃后撤销易位权（gstack P2#14）----------
    Private Sub TestCastlingRightRevokedOnRookCapture()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(7, 4) = "K"c : s.Board(7, 7) = "R"c   ' 白王 e1 + 白车 h1
        s.Board(0, 7) = "r"c : s.Board(0, 4) = "k"c   ' 黑车 h8 + 黑王 e8
        s.WhiteToMove = False

        Dim move As Move? = Nothing
        For Each m As Move In Rules.GenerateLegalMoves(s, 0, 7)
            If m.ToRow = 7 AndAlso m.ToCol = 7 Then move = m
        Next
        Check("黑车可走到 h1 吃掉白车", move.HasValue)
        Dim after As GameState = s.Clone()
        Rules.ApplyMove(after, move.Value)
        Check("角格白车被吃后白方失去短易位权", Not after.CanCastleWK)
        Check("黑车已占领 h1", after.Board(7, 7) = "r"c)
    End Sub

    ' ---------- 23. 退化局面（gstack P2#14）----------
    Private Sub TestDegeneratePositions()
        ' 空盘：任意格不被任何方攻击
        Dim empty As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                empty.Board(r, c) = "."c
            Next
        Next
        Check("空盘 a1 不被攻击", Not Rules.IsAttacked(empty.Board, 7, 0, True) AndAlso Not Rules.IsAttacked(empty.Board, 7, 0, False))
        Check("空盘 e4 不被攻击", Not Rules.IsAttacked(empty.Board, 4, 4, True) AndAlso Not Rules.IsAttacked(empty.Board, 4, 4, False))

        ' 单王对单王：FindBestMove 有合法着法（王可走）
        Dim kk As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                kk.Board(r, c) = "."c
            Next
        Next
        kk.Board(7, 4) = "K"c : kk.Board(0, 4) = "k"c
        Dim bm As Move? = ChessAIEngine.AIEngine.FindBestMove(kk, 1)
        Check("K vs K 局面 FindBestMove 有值（王可走）", bm.HasValue)

        ' 将死局面：FindBestMove 返回 Nothing（无合法着法）
        Dim mate As New GameState()
        mate = Play(mate, 6, 4, 4, 4) : mate = Play(mate, 1, 4, 3, 4)
        mate = Play(mate, 7, 5, 4, 2) : mate = Play(mate, 0, 1, 2, 2)
        mate = Play(mate, 7, 3, 3, 7) : mate = Play(mate, 0, 6, 2, 5)
        mate = Play(mate, 3, 7, 1, 5)   ' 4. Qxf7#（黑被将死）
        Dim mateMove As Move? = ChessAIEngine.AIEngine.FindBestMove(mate, 1)
        Check("将死局面 FindBestMove = Nothing", Not mateMove.HasValue)
    End Sub

    ' ---------- 24. 升变 SAN 记谱（gstack P2#14）----------
    Private Sub TestPromotionSAN()
        Dim s As New GameState()
        For r = 0 To 7
            For c = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next
        s.Board(1, 4) = "P"c      ' 白兵 e7
        s.Board(7, 4) = "K"c
        s.Board(0, 7) = "k"c

        Dim qmove As Move? = Nothing
        For Each m As Move In Rules.GenerateLegalMoves(s, 1, 4)
            If m.Special = SpecialMove.Promotion AndAlso m.Promotion = "Q"c Then qmove = m
        Next
        Check("升后走法存在", qmove.HasValue)
        If qmove.HasValue Then
            Check("升变 SAN 含 =Q", qmove.Value.ToString().Contains("=Q"))
            Check("升变 SAN = e8=Q", qmove.Value.ToString() = "e8=Q")
        End If
    End Sub

End Module
