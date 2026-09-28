' =============================================================================
' ChessUI.vb — 国际象棋图形界面（Windows Forms + GDI+）
' -----------------------------------------------------------------------------
' 交互模型：
'   点击己方棋子 → 选中并高亮全部合法走法 → 点击目标格走子（升变时弹窗选择）
' 辅助功能：走子高亮、将军提示、历史记录、悔棋、新对局
' 棋子渲染：Unicode 实心字形（白棋白填黑描边 / 黑棋黑填），无外部资源依赖
' =============================================================================

Option Explicit On
Option Strict On
Option Infer On

Imports System.Collections.Generic
Imports System.Drawing
Imports System.Drawing.Text
Imports System.Windows.Forms
Imports ChessCore

Namespace ChessUI

    Public Class MainForm : Inherits Form

        ' ---- 布局常量 ----
        Private Const Sq As Integer = 72            ' 单格像素
        Private Const BoardPx As Integer = Sq * 8   ' 棋盘边长 576
        Private Const OriginX As Integer = 16       ' 棋盘左上角
        Private Const OriginY As Integer = 16

        ' ---- 对局数据 ----
        Private game As New GameState()
        Private snapshots As New List(Of GameState)   ' 悔棋快照栈
        Private selectedR As Integer = -1
        Private selectedC As Integer = -1
        Private legalForSelected As List(Of Move) = Nothing
        Private lastMove As Move? = Nothing
        Private gameOver As Boolean = False

        ' ---- AI 对弈 ----
        Private aiThinking As Boolean = False         ' AI 后台计算中
        Private aiThread As Threading.Thread = Nothing
        ' AI 计算代次：每次新对局/悔棋/切换模式时自增，用于丢弃过期的后台回调（线程竞态修复）
        Private aiGeneration As Integer = 0
        ' AI 搜索取消源：新对局/悔棋/切换模式时 Cancel()，真正中止在途后台线程（epoch + abort 双保险）
        Private aiCts As Threading.CancellationTokenSource = Nothing
        ' 模式：0=双人对弈 1=人机（人执白） 2=人机（人执黑）
        Private gameMode As Integer = 0
        ' AI 搜索深度（难度）
        Private aiDepth As Integer = 2

        ' ---- UI 控件 ----
        Private historyList As ListBox
        Private btnNew As Button
        Private btnUndo As Button
        Private modeBox As ComboBox
        Private depthBox As ComboBox
        Private pieceFont As Font
        Private coordFont As Font

        ' ---- 颜色 ----
        Private lightColor As Color = Color.FromArgb(240, 217, 181)
        Private darkColor As Color = Color.FromArgb(181, 136, 99)
        Private selectColor As Color = Color.FromArgb(106, 168, 79)
        Private lastMoveColor As Color = Color.FromArgb(249, 215, 104)
        Private checkColor As Color = Color.FromArgb(221, 74, 60)

        Public Sub New()
            Me.Text = "国际象棋 — VB.NET 基本框架"
            Me.ClientSize = New Size(OriginX + BoardPx + 210, OriginY + BoardPx + 70)
            Me.FormBorderStyle = FormBorderStyle.FixedSingle
            Me.MaximizeBox = False
            Me.StartPosition = FormStartPosition.CenterScreen
            Me.DoubleBuffered = True
            Me.BackColor = Color.FromArgb(48, 46, 43)

            pieceFont = New Font("Segoe UI Symbol", 42, FontStyle.Regular, GraphicsUnit.Pixel)
            coordFont = New Font("Consolas", 11, FontStyle.Regular, GraphicsUnit.Pixel)

            ' ---- 右侧面板：模式 / 难度 / 历史记录 / 按钮 ----
            Dim panelX As Integer = OriginX + BoardPx + 18
            Dim panelW As Integer = 186

            modeBox = New ComboBox()
            modeBox.DropDownStyle = ComboBoxStyle.DropDownList
            modeBox.Items.AddRange(New String() {"双人对弈", "人机对弈（执白）", "人机对弈（执黑）"})
            modeBox.SelectedIndex = 0
            modeBox.Location = New Point(panelX, OriginY)
            modeBox.Size = New Size(panelW, 28)
            modeBox.Font = New Font("微软雅黑", 11, FontStyle.Regular, GraphicsUnit.Pixel)
            AddHandler modeBox.SelectedIndexChanged, AddressOf OnModeChanged
            Me.Controls.Add(modeBox)

            depthBox = New ComboBox()
            depthBox.DropDownStyle = ComboBoxStyle.DropDownList
            depthBox.Items.AddRange(New String() {"难度：新手（1 层）", "难度：中级（2 层）", "难度：高级（3 层）"})
            depthBox.SelectedIndex = 1
            depthBox.Location = New Point(panelX, OriginY + 34)
            depthBox.Size = New Size(panelW, 28)
            depthBox.Font = New Font("微软雅黑", 11, FontStyle.Regular, GraphicsUnit.Pixel)
            AddHandler depthBox.SelectedIndexChanged, AddressOf OnDepthChanged
            Me.Controls.Add(depthBox)

            historyList = New ListBox()
            historyList.Location = New Point(panelX, OriginY + 70)
            historyList.Size = New Size(panelW, 390)
            historyList.Font = New Font("Consolas", 12, FontStyle.Regular, GraphicsUnit.Pixel)
            historyList.BackColor = Color.FromArgb(63, 60, 56)
            historyList.ForeColor = Color.White
            historyList.BorderStyle = BorderStyle.FixedSingle
            Me.Controls.Add(historyList)

            ' ---- 按钮 ----
            btnNew = New Button()
            btnNew.Text = "新对局"
            btnNew.Location = New Point(panelX, OriginY + 468)
            btnNew.Size = New Size(panelW, 34)
            AddHandler btnNew.Click, AddressOf OnNewGame
            Me.Controls.Add(btnNew)

            btnUndo = New Button()
            btnUndo.Text = "悔棋"
            btnUndo.Location = New Point(panelX, OriginY + 508)
            btnUndo.Size = New Size(panelW, 34)
            AddHandler btnUndo.Click, AddressOf OnUndo
            Me.Controls.Add(btnUndo)

            RefreshAll()
        End Sub

        ' ============================ AI 对弈 ============================

        ' 是否轮到 AI 走（人机模式下）
        Private ReadOnly Property IsAITurn() As Boolean
            Get
                If gameMode = 0 OrElse gameOver OrElse aiThinking Then Return False
                If gameMode = 1 Then Return Not game.WhiteToMove   ' 人执白 → AI 执黑
                If gameMode = 2 Then Return game.WhiteToMove       ' 人执黑 → AI 执白
                Return False
            End Get
        End Property

        Private Sub OnModeChanged(ByVal sender As Object, ByVal e As EventArgs)
            gameMode = modeBox.SelectedIndex
            aiGeneration += 1   ' 废弃任何在途 AI 回调
            TriggerAIIfNeeded()
        End Sub

        Private Sub OnDepthChanged(ByVal sender As Object, ByVal e As EventArgs)
            aiDepth = depthBox.SelectedIndex + 1
        End Sub

        ' 走子后（或模式切换/新对局后）触发 AI（若轮到 AI）
        Private Sub TriggerAIIfNeeded()
            If Not IsAITurn Then
                Me.Invalidate()
                Return
            End If

            aiThinking = True
            ClearSelection()
            Me.Invalidate()

            ' 快照当前局面供后台线程读取（避免与 UI 并发改动）
            Dim snapshot As GameState = game.Clone()
            Dim depth As Integer = aiDepth
            ' 捕获当前代次，后台回调返回时比对，过期则丢弃（修复线程竞态）
            Dim gen As Integer = aiGeneration
            ' 复用/新建取消源：新对局、悔棋、切换模式时 Cancel() 可立即中止在途搜索
            If aiCts IsNot Nothing Then aiCts.Dispose()
            aiCts = New Threading.CancellationTokenSource()
            Dim token As Threading.CancellationToken = aiCts.Token

            aiThread = New Threading.Thread(Sub()
                                                Dim best As Move? = ChessAIEngine.AIEngine.FindBestMove(snapshot, depth, token)
                                                Me.BeginInvoke(Sub() OnAIDone(best, gen))
                                            End Sub)
            aiThread.IsBackground = True
            aiThread.Start()
        End Sub

        ' AI 计算完成（回到 UI 线程执行走子）
        Private Sub OnAIDone(ByVal best As Move?, ByVal gen As Integer)
            ' 过期回调（新对局/悔棋/切换模式后旧搜索结束）→ 直接丢弃，绝不落到新棋局
            If gen <> aiGeneration Then Return
            aiThinking = False
            If Not best.HasValue OrElse gameOver Then
                Me.Invalidate()
                Return
            End If
            ' 竞态保护：仅当仍轮到 AI 时落子
            If Not IsAITurn Then
                Me.Invalidate()
                Return
            End If

            snapshots.Add(game.Clone())
            If snapshots.Count > 512 Then snapshots.RemoveAt(0)

            Rules.ApplyMove(game, best.Value)
            lastMove = best

            If Rules.IsCheckmate(game) OrElse Rules.IsStalemate(game) OrElse
               Rules.IsFiftyMoveDraw(game) OrElse Rules.IsInsufficientMaterial(game) OrElse
               Rules.IsThreefoldRepetition(game) Then
                gameOver = True
            End If

            RefreshAll()
        End Sub

        ' ============================ 绘制 ============================

        Protected Overrides Sub OnPaint(ByVal e As PaintEventArgs)
            MyBase.OnPaint(e)
            Dim g As Graphics = e.Graphics
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit

            DrawBoard(g)
            DrawCoordinates(g)
            DrawStatusBar(g)
        End Sub

        Private Sub DrawBoard(ByVal g As Graphics)
            Dim board As Char(,) = game.Board

            ' 找到被将军一方的王（用于红格高亮）
            Dim checkKingR As Integer = -1, checkKingC As Integer = -1
            If Rules.IsInCheck(game, game.WhiteToMove) Then
                Rules.FindKing(board, game.WhiteToMove, checkKingR, checkKingC)
            End If

            For r = 0 To 7
                For c = 0 To 7
                    Dim x As Integer = OriginX + c * Sq
                    Dim y As Integer = OriginY + r * Sq

                    ' 1. 底色
                    Dim baseColor As Color = If((r + c) Mod 2 = 0, lightColor, darkColor)
                    Using br As New SolidBrush(baseColor)
                        g.FillRectangle(br, x, y, Sq, Sq)
                    End Using

                    ' 2. 高亮层：上一步 → 选中 → 将军
                    If lastMove.HasValue Then
                        Dim lm As Move = lastMove.Value
                        If (lm.FromRow = r AndAlso lm.FromCol = c) OrElse (lm.ToRow = r AndAlso lm.ToCol = c) Then
                            Using br As New SolidBrush(Color.FromArgb(110, lastMoveColor))
                                g.FillRectangle(br, x, y, Sq, Sq)
                            End Using
                        End If
                    End If
                    If selectedR = r AndAlso selectedC = c Then
                        Using br As New SolidBrush(Color.FromArgb(170, selectColor))
                            g.FillRectangle(br, x, y, Sq, Sq)
                        End Using
                    End If
                    If checkKingR = r AndAlso checkKingC = c Then
                        Using br As New SolidBrush(Color.FromArgb(150, checkColor))
                            g.FillRectangle(br, x, y, Sq, Sq)
                        End Using
                    End If

                    ' 3. 合法走法标记（圆点=空格 / 圆环=吃子格）
                    If legalForSelected IsNot Nothing Then
                        For Each m As Move In legalForSelected
                            If m.ToRow = r AndAlso m.ToCol = c Then
                                If m.Captured = "."c Then
                                    Using br As New SolidBrush(Color.FromArgb(90, 40, 40, 40))
                                        g.FillEllipse(br, x + Sq \ 2 - 9, y + Sq \ 2 - 9, 18, 18)
                                    End Using
                                Else
                                    Using pn As New Pen(Color.FromArgb(150, 40, 40, 40), 5)
                                        g.DrawEllipse(pn, x + 10, y + 10, Sq - 20, Sq - 20)
                                    End Using
                                End If
                                Exit For
                            End If
                        Next
                    End If

                    ' 4. 棋子
                    Dim p As Char = board(r, c)
                    If p <> "."c Then
                        DrawPiece(g, p, x, y)
                    End If
                Next
            Next

            ' 棋盘外框
            g.DrawRectangle(New Pen(Color.FromArgb(28, 26, 24), 2), OriginX - 2, OriginY - 2, BoardPx + 4, BoardPx + 4)
        End Sub

        ' 棋子渲染：Unicode 实心字形；白棋 = 白填充 + 黑描边（四向偏移法）
        Private Sub DrawPiece(ByVal g As Graphics, ByVal p As Char, ByVal x As Integer, ByVal y As Integer)
            Dim glyph As Char
            Select Case Char.ToUpper(p)
                Case "K"c : glyph = ChrW(&H265A)
                Case "Q"c : glyph = ChrW(&H265B)
                Case "R"c : glyph = ChrW(&H265C)
                Case "B"c : glyph = ChrW(&H265D)
                Case "N"c : glyph = ChrW(&H265E)
                Case "P"c : glyph = ChrW(&H265F)
                Case Else : glyph = "?"c
            End Select

            Dim rect As New RectangleF(x, y + 2, Sq, Sq - 4)
            Dim sf As New StringFormat()
            sf.Alignment = StringAlignment.Center
            sf.LineAlignment = StringAlignment.Center

            If Char.IsUpper(p) Then
                ' 白棋：黑描边 + 白填充
                For Each off As Point In New Point() {New Point(-2, 0), New Point(2, 0), New Point(0, -2), New Point(0, 2), New Point(-1, -1), New Point(1, 1), New Point(-1, 1), New Point(1, -1)}
                    g.DrawString(glyph.ToString(), pieceFont, Brushes.Black, New RectangleF(rect.X + off.X, rect.Y + off.Y, rect.Width, rect.Height), sf)
                Next
                g.DrawString(glyph.ToString(), pieceFont, Brushes.White, rect, sf)
            Else
                ' 黑棋：白描边 + 黑填充（浅色格上保证可见）
                For Each off As Point In New Point() {New Point(-2, 0), New Point(2, 0), New Point(0, -2), New Point(0, 2)}
                    g.DrawString(glyph.ToString(), pieceFont, Brushes.White, New RectangleF(rect.X + off.X, rect.Y + off.Y, rect.Width, rect.Height), sf)
                Next
                g.DrawString(glyph.ToString(), pieceFont, Brushes.Black, rect, sf)
            End If
        End Sub

        ' 棋盘坐标（a-h / 1-8）
        Private Sub DrawCoordinates(ByVal g As Graphics)
            Dim files As String = "abcdefgh"
            Dim textColor As Color = Color.FromArgb(190, 180, 170)
            Using br As New SolidBrush(textColor)
                For c = 0 To 7
                    g.DrawString(files(c).ToString(), coordFont, br, OriginX + c * Sq + Sq - 16, OriginY + BoardPx + 6)
                Next
                For r = 0 To 7
                    g.DrawString((8 - r).ToString(), coordFont, br, OriginX - 14, OriginY + r * Sq + 4)
                Next
            End Using
        End Sub

        ' 底部状态栏
        Private Sub DrawStatusBar(ByVal g As Graphics)
            Dim msg As String
            Dim msgColor As Color
            If gameOver Then
                msg = GetResultText()
                msgColor = Color.FromArgb(249, 215, 104)
            ElseIf aiThinking Then
                msg = "AI 思考中…（深度 " & aiDepth.ToString() & "）"
                msgColor = Color.FromArgb(130, 202, 237)
            Else
                Dim side As String = If(game.WhiteToMove, "白方行棋", "黑方行棋")
                If gameMode = 1 AndAlso Not game.WhiteToMove Then side = "AI（黑方）行棋"
                If gameMode = 2 AndAlso game.WhiteToMove Then side = "AI（白方）行棋"
                If Rules.IsInCheck(game, game.WhiteToMove) Then
                    msg = side & " — 将军！"
                    msgColor = Color.FromArgb(235, 97, 80)
                Else
                    msg = side
                    msgColor = Color.FromArgb(235, 231, 222)
                End If
            End If
            Using br As New SolidBrush(msgColor)
                g.DrawString(msg, New Font("微软雅黑", 15, FontStyle.Bold, GraphicsUnit.Pixel), br, OriginX, OriginY + BoardPx + 34)
            End Using
            ' 半步计数（50 步规则进度）
            Using br As New SolidBrush(Color.FromArgb(150, 142, 135))
                g.DrawString("半步计数: " & game.HalfmoveClock.ToString() & " / 100", New Font("Consolas", 11, GraphicsUnit.Pixel), br, OriginX + 320, OriginY + BoardPx + 40)
            End Using
        End Sub

        ' ============================ 交互 ============================

        Protected Overrides Sub OnMouseClick(ByVal e As MouseEventArgs)
            MyBase.OnMouseClick(e)
            If gameOver OrElse aiThinking OrElse IsAITurn Then Return

            Dim col As Integer = (e.X - OriginX) \ Sq
            Dim row As Integer = (e.Y - OriginY) \ Sq
            If row < 0 OrElse row > 7 OrElse col < 0 OrElse col > 7 Then
                ClearSelection()
                Me.Invalidate()
                Return
            End If

            ' 已选中 → 尝试走子
            If selectedR >= 0 AndAlso legalForSelected IsNot Nothing Then
                Dim matched As New List(Of Move)
                For Each m As Move In legalForSelected
                    If m.ToRow = row AndAlso m.ToCol = col Then matched.Add(m)
                Next
                If matched.Count > 0 Then
                    ExecuteMove(matched)
                    Return
                End If
            End If

            ' 点击己方棋子 → 选中
            Dim p As Char = game.Board(row, col)
            If Rules.IsPieceOfSide(p, game.WhiteToMove) Then
                selectedR = row
                selectedC = col
                legalForSelected = Rules.GenerateLegalMoves(game, row, col)
            Else
                ClearSelection()
            End If
            Me.Invalidate()
        End Sub

        ' 执行走子（升变时弹窗选择目标棋子）
        Private Sub ExecuteMove(ByVal matched As List(Of Move))
            Dim mv As Move = matched(0)
            If matched.Count > 1 Then
                ' 多个走法到同一格 = 升变（Q/R/B/N 四选一）
                Dim promo As Char = AskPromotion(game.WhiteToMove)
                mv = matched(0)
                For Each m As Move In matched
                    If m.Promotion = promo Then
                        mv = m
                        Exit For
                    End If
                Next
            End If

            ' 悔棋快照
            snapshots.Add(game.Clone())
            If snapshots.Count > 512 Then snapshots.RemoveAt(0)

            Rules.ApplyMove(game, mv)
            lastMove = mv
            ClearSelection()

            ' 终局检测（含三次重复局面判和）
            If Rules.IsCheckmate(game) OrElse Rules.IsStalemate(game) OrElse
               Rules.IsFiftyMoveDraw(game) OrElse Rules.IsInsufficientMaterial(game) OrElse
               Rules.IsThreefoldRepetition(game) Then
                gameOver = True
            End If

            RefreshAll()

            ' 人机模式：轮到 AI 时后台启动搜索
            TriggerAIIfNeeded()
        End Sub

        ' 升变选择对话框
        Private Function AskPromotion(ByVal isWhite As Boolean) As Char
            Dim dlg As New Form()
            dlg.Text = "兵升变 — 选择目标棋子"
            dlg.FormBorderStyle = FormBorderStyle.FixedDialog
            dlg.ClientSize = New Size(340, 84)
            dlg.StartPosition = FormStartPosition.CenterParent
            dlg.MaximizeBox = False
            dlg.MinimizeBox = False
            dlg.ShowInTaskbar = False

            Dim result As Char = "Q"c
            Dim names As String = "后车象马"
            Dim glyphs As String = "QRBN"
            For i = 0 To 3
                Dim idx As Integer = i
                Dim btn As New Button()
                btn.Text = names(idx).ToString() & " " & glyphs(idx).ToString()
                btn.Left = 10 + idx * 82
                btn.Top = 22
                btn.Width = 78
                btn.Height = 40
                btn.Font = New Font("微软雅黑", 12, FontStyle.Bold, GraphicsUnit.Pixel)
                AddHandler btn.Click, Sub(s As Object, ev As EventArgs)
                                         result = glyphs(idx)
                                         dlg.Close()
                                     End Sub
                dlg.Controls.Add(btn)
            Next
            dlg.ShowDialog(Me)
            Return result
        End Function

        ' ============================ 按钮动作 ============================

        Private Sub OnNewGame(ByVal sender As Object, ByVal e As EventArgs)
            WaitForAIThread()
            aiGeneration += 1   ' 废弃任何在途 AI 回调
            game = New GameState()
            snapshots.Clear()
            lastMove = Nothing
            gameOver = False
            aiThinking = False
            ClearSelection()
            RefreshAll()
            ' 人机模式且 AI 执白 → AI 先行
            TriggerAIIfNeeded()
        End Sub

        Private Sub OnUndo(ByVal sender As Object, ByVal e As EventArgs)
            If snapshots.Count = 0 Then Return
            WaitForAIThread()
            aiGeneration += 1   ' 废弃任何在途 AI 回调
            aiThinking = False

            ' 人机模式：一次退两步（AI 的一步 + 人的一步），避免退到 AI 回合立即重走
            Dim steps As Integer = 1
            If gameMode <> 0 AndAlso snapshots.Count >= 2 Then steps = 2

            game = snapshots(snapshots.Count - steps)
            For i = 1 To steps
                snapshots.RemoveAt(snapshots.Count - 1)
            Next

            gameOver = False
            lastMove = Nothing
            ClearSelection()
            RefreshAll()
        End Sub

        ' 等待 AI 后台线程结束（新对局/悔棋前调用，防止竞态）
        ' 同时发出取消信号：若搜索仍在进行，Cancel() 让其立即抛出并退出，避免长时间阻塞 UI 线程
        Private Sub WaitForAIThread()
            If aiThread IsNot Nothing AndAlso aiThread.IsAlive Then
                If aiCts IsNot Nothing Then aiCts.Cancel()   ' 真正中止在途搜索（abort 守卫）
                aiThread.Join(2000)
            End If
            If aiCts IsNot Nothing Then aiCts.Dispose() : aiCts = Nothing
            aiThread = Nothing
        End Sub

        ' ============================ 工具 ============================

        Private Sub ClearSelection()
            selectedR = -1
            selectedC = -1
            legalForSelected = Nothing
        End Sub

        Private Function GetResultText() As String
            If Rules.IsCheckmate(game) Then
                Dim winner As String = If(game.WhiteToMove, "黑方", "白方")
                If gameMode <> 0 Then
                    winner &= "（AI）"
                End If
                Return "将死！ " & winner & "获胜"
            ElseIf Rules.IsStalemate(game) Then
                Return "和棋 — 无子可动（逼和）"
            ElseIf Rules.IsThreefoldRepetition(game) Then
                Return "和棋 — 三次重复局面"
            ElseIf Rules.IsFiftyMoveDraw(game) Then
                Return "和棋 — 50 步规则"
            ElseIf Rules.IsInsufficientMaterial(game) Then
                Return "和棋 — 子力不足"
            End If
            Return "对局结束"
        End Function

        Private Sub RefreshAll()
            ' 重建历史列表
            historyList.BeginUpdate()
            historyList.Items.Clear()
            For i = 0 To game.History.Count - 1 Step 2
                Dim line As String
                If i + 1 < game.History.Count Then
                    line = String.Format("{0,3}. {1,-8} {2,-8}", (i \ 2) + 1, game.History(i), game.History(i + 1))
                Else
                    line = String.Format("{0,3}. {1,-8}", (i \ 2) + 1, game.History(i))
                End If
                historyList.Items.Add(line)
            Next
            If historyList.Items.Count > 0 Then historyList.SelectedIndex = historyList.Items.Count - 1
            historyList.EndUpdate()

            btnUndo.Enabled = snapshots.Count > 0
            Me.Invalidate()
        End Sub

    End Class

End Namespace

' ============================ 程序入口 ============================
Module Program

    <STAThread()>
    Sub Main()
        Application.EnableVisualStyles()
        Application.SetCompatibleTextRenderingDefault(False)
        Application.Run(New ChessUI.MainForm())
    End Sub

End Module
