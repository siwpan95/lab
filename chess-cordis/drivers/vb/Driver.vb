' =============================================================================
' Driver.vb - chess-cordis harness-side JSON-stdio driver for VBChess
' -----------------------------------------------------------------------------
' Reuses the pure VBChess core (ChessCore.GameState / Rules / ChessAIEngine.AIEngine)
' and serves perft / bestMove over line-delimited JSON. This file belongs to the
' harness, NOT the engine; the engine stays zero-dependency and cordis-unaware.
'
' Build (consumes the real .NET Framework vbc shipped with Windows):
'   vbc -nologo -codepage:65001 -optimize -r:System.dll -main:Driver ^
'        -out:drivers/vb/VBChessDriver.exe ^
'        E:\lab\VBChess\ChessCore.vb E:\lab\VBChess\ChessAI.vb drivers\vb\Driver.vb
' =============================================================================

Option Explicit On
Option Strict On

Imports System
Imports System.Collections.Generic
Imports System.Text
Imports ChessCore
Imports ChessAIEngine

Module Driver

    ' FEN -> GameState. GameState.New() calls ResetToStartPosition() and prefills
    ' the board, so we clear it first (same boundary as the C#/TS drivers).
    Function setupFromFen(ByVal fen As String) As GameState
        Dim s As New GameState()
        For r As Integer = 0 To 7
            For c As Integer = 0 To 7
                s.Board(r, c) = "."c
            Next
        Next

        Dim parts() As String = fen.Split(New Char() {" "c}, StringSplitOptions.RemoveEmptyEntries)
        Dim ranks() As String = parts(0).Split("/"c)
        Dim side As String = If(parts.Length > 1, parts(1), "w")
        Dim castling As String = If(parts.Length > 2, parts(2), "-")
        Dim ep As String = If(parts.Length > 3, parts(3), "-")
        Dim halfmove As Integer = If(parts.Length > 4, Integer.Parse(parts(4)), 0)
        Dim fullmove As Integer = If(parts.Length > 5, Integer.Parse(parts(5)), 1)

        For r As Integer = 0 To 7
            Dim rank As String = ranks(r)
            Dim col As Integer = 0
            For i As Integer = 0 To rank.Length - 1
                Dim ch As Char = rank(i)
                If ch >= "1"c AndAlso ch <= "9"c Then
                    Dim n As Integer = Asc(ch) - Asc("0"c)
                    For k As Integer = 0 To n - 1
                        s.Board(r, col) = "."c
                        col += 1
                    Next
                Else
                    s.Board(r, col) = ch
                    col += 1
                End If
            Next
        Next

        s.WhiteToMove = (side = "w")
        s.CanCastleWK = (castling.IndexOf("K"c) >= 0)
        s.CanCastleWQ = (castling.IndexOf("Q"c) >= 0)
        s.CanCastleBK = (castling.IndexOf("k"c) >= 0)
        s.CanCastleBQ = (castling.IndexOf("q"c) >= 0)
        s.EnPassantRow = -1
        s.EnPassantCol = -1
        If ep.Length = 2 Then
            s.EnPassantCol = Asc(ep(0)) - Asc("a"c)
            s.EnPassantRow = 8 - (Asc(ep(1)) - Asc("0"c))
        End If
        s.HalfmoveClock = halfmove
        s.FullmoveNumber = fullmove
        s.History.Clear()
        s.PositionKeys.Clear()
        Return s
    End Function

    Function perft(ByVal state As GameState, ByVal depth As Integer) As Long
        If depth = 0 Then Return 1
        Dim moves As List(Of Move) = Rules.GenerateAllLegalMoves(state)
        If depth = 1 Then Return moves.Count
        Dim count As Long = 0
        For Each m As Move In moves
            Dim child As GameState = state.Clone()
            Rules.ApplyMove(child, m, False)
            count += perft(child, depth - 1)
        Next
        Return count
    End Function

    Function moveToUci(ByVal m As Move) As String
        Dim files As String = "abcdefgh"
        Dim fromS As String = files(m.FromCol).ToString() & Chr(Asc("0"c) + (8 - m.FromRow))
        Dim toS As String = files(m.ToCol).ToString() & Chr(Asc("0"c) + (8 - m.ToRow))
        Dim uci As String = fromS & toS
        If m.Promotion <> "."c AndAlso m.Promotion <> Chr(0) Then
            uci &= Char.ToLower(m.Promotion).ToString()
        End If
        Return uci
    End Function

    ' Minimal JSON string escape (uses Chr() to avoid quote-literal confusion).
    Function esc(ByVal v As String) As String
        If v Is Nothing Then Return ""
        Dim sb As New StringBuilder()
        For i As Integer = 0 To v.Length - 1
            Dim c As Char = v(i)
            If c = Chr(34) Then
                sb.Append(Chr(92) & Chr(34))
            ElseIf c = Chr(92) Then
                sb.Append(Chr(92) & Chr(92))
            ElseIf c = vbCr Then
                sb.Append(Chr(92) & "r"c)
            ElseIf c = vbLf Then
                sb.Append(Chr(92) & "n"c)
            ElseIf c = vbTab Then
                sb.Append(Chr(92) & "t"c)
            Else
                sb.Append(c)
            End If
        Next
        Return sb.ToString()
    End Function

    ' --- Minimal JSON field extractors (harness emits id/cmd/fen/depth) ---
    Function getStr(ByVal json As String, ByVal key As String) As String
        Dim needle As String = Chr(34) & key & Chr(34) & ":"
        Dim idx As Integer = json.IndexOf(needle)
        If idx < 0 Then Return ""
        Dim after As Integer = idx + needle.Length
        Dim openQ As Integer = json.IndexOf(Chr(34), after)
        If openQ < 0 Then Return ""
        Dim closeQ As Integer = json.IndexOf(Chr(34), openQ + 1)
        If closeQ < 0 Then Return ""
        Return json.Substring(openQ + 1, closeQ - openQ - 1)
    End Function

    Function getInt(ByVal json As String, ByVal key As String) As Integer
        Dim needle As String = Chr(34) & key & Chr(34) & ":"
        Dim idx As Integer = json.IndexOf(needle)
        If idx < 0 Then Return 0
        Dim p As Integer = idx + needle.Length
        While p < json.Length AndAlso json(p) <> "-"c AndAlso Not (json(p) >= "0"c AndAlso json(p) <= "9"c)
            p += 1
        End While
        Dim startA As Integer = p
        While p < json.Length AndAlso (json(p) = "-"c OrElse (json(p) >= "0"c AndAlso json(p) <= "9"c))
            p += 1
        End While
        If p = startA Then Return 0
        Return Integer.Parse(json.Substring(startA, p - startA))
    End Function

    Sub outLine(ByVal line As String)
        Console.WriteLine(line)
        Console.Out.Flush()
    End Sub

    Sub Main()
        outLine("{""ready"":true}")
        Dim line As String = Console.ReadLine()
        While line IsNot Nothing
            If line.Trim().Length > 0 Then
                Try
                    Dim id As String = getStr(line, "id")
                    Dim cmd As String = getStr(line, "cmd")
                    Dim fen As String = getStr(line, "fen")
                    Dim depth As Integer = getInt(line, "depth")
                    Dim state As GameState = setupFromFen(fen)
                    If cmd = "perft" Then
                        Dim nodes As Long = perft(state, depth)
                        outLine("{""id"":""" & esc(id) & """,""ok"":true,""nodes"":" & nodes.ToString() & "}")
                    ElseIf cmd = "legalMoves" Then
                        Dim n As Integer = Rules.GenerateAllLegalMoves(state).Count
                        outLine("{""id"":""" & esc(id) & """,""ok"":true,""moves"":" & n.ToString() & "}")
                    ElseIf cmd = "bestMove" Then
                        Dim sd As Integer = If(depth < 1, 3, depth)
                        Dim mv As Move? = AIEngine.FindBestMove(state, sd)
                        If mv Is Nothing Then
                            outLine("{""id"":""" & esc(id) & """,""ok"":false,""error"":""no legal move""}")
                        Else
                            outLine("{""id"":""" & esc(id) & """,""ok"":true,""move"":""" & esc(moveToUci(mv.Value)) & """,""score"":0}")
                        End If
                    Else
                        outLine("{""id"":""" & esc(id) & """,""ok"":false,""error"":""unknown cmd""}")
                    End If
                Catch ex As Exception
                    outLine("{""id"":"""",""ok"":false,""error"":""" & esc(ex.Message) & """}")
                End Try
            End If
            line = Console.ReadLine()
        End While
    End Sub

End Module
