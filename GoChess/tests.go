// =============================================================================
// tests.go — 核心规则自测（Go，移植 C++ tests.cpp 的 24 组 / 97 项断言）
// 覆盖：初始走法数 / IsAttacked / 过路兵 / 易位 / 升变 / 将死 / 逼和 /
//       子力不足 / 50 步 / 三次重复 / 评估 / negamax 终局 / AI 杀棋 / 钉死 /
//       逃将 / EP 揭将 / 子力不足扩展 / 深度3计时 / 角格撤销易位权 /
//       退化局面 / 升变 SAN
// =============================================================================

package main

import (
	"fmt"
	"strings"
	"time"
)

var testPass, testFail int

func check(name string, cond bool) {
	if cond {
		testPass++
		fmt.Println("[PASS] " + name)
	} else {
		testFail++
		fmt.Println("[FAIL] " + name)
	}
}

// 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
func findMove(state *GameState, r, c, tr, tc int) Move {
	for _, m := range GenerateLegalMoves(state, r, c) {
		if m.ToRow == tr && m.ToCol == tc {
			return m
		}
	}
	panic("move not found")
}

// 走一步并返回新状态（深拷贝 + 应用）
func play(state GameState, r, c, tr, tc int) GameState {
	m := findMove(&state, r, c, tr, tc)
	s := state.Clone()
	ApplyMove(&s, m, true)
	return s
}

// ---------- perft 黄金值测试（跨语言交叉验证） ----------
// 由 8 个 FEN 式横线串（第 8 横线在前）+ 行棋方 + 易位串 构建局面。
// 每个横线串逐字符展开：字母 => 该棋子字节；数字 N => N 个空格('.')。
// 过路兵设为无，半步计数=0，整步计数=1。
func setupPosition(ranks [8]string, whiteToMove bool, castling string) GameState {
	var s GameState
	for r := 0; r < 8; r++ {
		col := 0
		for _, ch := range ranks[r] {
			if ch >= '1' && ch <= '9' {
				for i := 0; i < int(ch-'0'); i++ {
					s.Board[r][col] = '.'
					col++
				}
			} else {
				s.Board[r][col] = byte(ch)
				col++
			}
		}
	}
	s.WhiteToMove = whiteToMove
	s.CanCastleWK = strings.Contains(castling, "K")
	s.CanCastleWQ = strings.Contains(castling, "Q")
	s.CanCastleBK = strings.Contains(castling, "k")
	s.CanCastleBQ = strings.Contains(castling, "q")
	s.EnPassantRow = -1
	s.EnPassantCol = -1
	s.HalfmoveClock = 0
	s.FullmoveNumber = 1
	return s
}

// perft 节点计数（与现有测试一致的 Clone + ApplyMove 形式）
func perft(state GameState, depth int) int64 {
	if depth == 0 {
		return 1
	}
	moves := GenerateAllLegalMoves(&state)
	if depth == 1 {
		return int64(len(moves))
	}
	var count int64 = 0
	for _, m := range moves {
		child := state.Clone()
		ApplyMove(&child, m, true)
		count += perft(child, depth-1)
	}
	return count
}

func testPerft() {
	// Pos1 "Start"
	start := [8]string{"rnbqkbnr", "pppppppp", "........", "........", "........", "........", "PPPPPPPP", "RNBQKBNR"}
	s1 := setupPosition(start, true, "KQkq")
	check("Perft Start d1 == 20", perft(s1, 1) == 20)
	check("Perft Start d2 == 400", perft(s1, 2) == 400)
	check("Perft Start d3 == 8902", perft(s1, 3) == 8902)
	check("Perft Start d4 == 197281", perft(s1, 4) == 197281)

	// Pos2 "Kiwipete"
	kiwi := [8]string{"r3k2r", "p1ppqpb1", "bn2pnp1", "3PN3", "1p2P3", "2N2Q1p", "PPPBBPPP", "R3K2R"}
	s2 := setupPosition(kiwi, true, "KQkq")
	check("Perft Kiwipete d1 == 48", perft(s2, 1) == 48)
	check("Perft Kiwipete d2 == 2039", perft(s2, 2) == 2039)
	check("Perft Kiwipete d3 == 97862", perft(s2, 3) == 97862)
	// Kiwipete d4 == 4085603 (>2M 节点，较慢，仅作注释参考，不自动运行)

	// Pos3 "Wiki3"  (canonical perft position 3: 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1)
	wiki3 := [8]string{"8", "2p5", "3p4", "KP5r", "1R3p1k", "8", "4P1P1", "8"}
	s3 := setupPosition(wiki3, true, "")
	check("Perft Wiki3 d1 == 14", perft(s3, 1) == 14)
	check("Perft Wiki3 d2 == 191", perft(s3, 2) == 191)
	check("Perft Wiki3 d3 == 2812", perft(s3, 3) == 2812)
	check("Perft Wiki3 d4 == 43238", perft(s3, 4) == 43238)

	// Pos4 "Wiki5"
	wiki5 := [8]string{"rnbq1k1r", "pp1Pbppp", "2p5", "8", "2B5", "8", "PPP1NnPP", "RNBQK2R"}
	s4 := setupPosition(wiki5, true, "KQ")
	check("Perft Wiki5 d1 == 44", perft(s4, 1) == 44)
	check("Perft Wiki5 d2 == 1486", perft(s4, 2) == 1486)
	check("Perft Wiki5 d3 == 62379", perft(s4, 3) == 62379)
	// Wiki5 d4 == 2103487 (>) // Wiki5 d4 == 2103487 (>2M 节点，较慢，仅作注释参考，不自动运行)
}

// 清空棋盘上所有棋子（测试用）
func emptyBoard(s *GameState) {
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			s.Board[r][c] = '.'
		}
	}
	s.CanCastleWK = false
	s.CanCastleWQ = false
	s.CanCastleBK = false
	s.CanCastleBQ = false
	s.EnPassantRow = -1
	s.EnPassantCol = -1
	s.HalfmoveClock = 0
	s.FullmoveNumber = 1
	s.History = nil
	s.PositionKeys = nil
	s.PositionKeys = append(s.PositionKeys, s.GetPositionKey())
}

// ---------- 1. 初始局面 ----------
func testInitialPosition() {
	s := NewGame()
	check("初始局面白方合法走法数 = 20", len(GenerateAllLegalMoves(&s)) == 20)
	check("初始局面 b1 马走法数 = 2", len(GenerateLegalMoves(&s, 7, 1)) == 2)
	check("初始局面 g1 马走法数 = 2", len(GenerateLegalMoves(&s, 7, 6)) == 2)
	check("初始局面 e2 兵走法数 = 2", len(GenerateLegalMoves(&s, 6, 4)) == 2)
	check("初始局面 d1 后走法数 = 0", len(GenerateLegalMoves(&s, 7, 3)) == 0)
	check("初始局面白王不被将军", !IsInCheck(&s, true))
	check("初始局面黑王不被将军", !IsInCheck(&s, false))
	check("初始局面非将死", !IsCheckmate(&s))

	b := NewGame()
	b.WhiteToMove = false
	check("初始局面黑方合法走法数 = 20", len(GenerateAllLegalMoves(&b)) == 20)
}

// ---------- 2. IsAttacked 基础语义 ----------
func testIsAttackedBasics() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[4][4] = 'P' // 白兵 e4
	s.Board[3][4] = 'p' // 黑兵 e5
	s.Board[7][4] = 'K' // 白王 e1
	s.Board[0][4] = 'k' // 黑王 e8

	check("白兵 e4 攻击 d5", IsAttacked(s.Board, 3, 3, true))
	check("白兵 e4 攻击 f5", IsAttacked(s.Board, 3, 5, true))
	check("白兵 e4 不攻击 e5（兵不直吃）", !IsAttacked(s.Board, 3, 4, true))
	check("黑兵 e5 攻击 d4", IsAttacked(s.Board, 4, 3, false))
	check("黑兵 e5 攻击 f4", IsAttacked(s.Board, 4, 5, false))
	check("a1 格不被任何方攻击", !IsAttacked(s.Board, 7, 0, true) && !IsAttacked(s.Board, 7, 0, false))
	check("白王 e1 攻击 e2", IsAttacked(s.Board, 6, 4, true))
}

// ---------- 3. 双进兵与吃过路兵 ----------
func testPawnDoubleAndEnPassant() {
	s := NewGame()
	s = play(s, 6, 4, 4, 4) // 1. e2-e4
	check("e4 双进兵设置过路兵格 (5,4)", s.EnPassantRow == 5 && s.EnPassantCol == 4)
	check("双进兵后半步计数 = 0", s.HalfmoveClock == 0)
	check("e4 后轮黑方", !s.WhiteToMove)

	t := NewGame()
	emptyBoard(&t)
	t.Board[3][4] = 'P' // 白兵 e5
	t.Board[1][3] = 'p' // 黑兵 d7（将双走进 d5）
	t.WhiteToMove = false
	t = play(t, 1, 3, 3, 3) // 黑 d7-d5 → ep 目标 d6 (2,3)
	check("黑 d5 双进后轮白方", t.WhiteToMove)

	pawnMoves := GenerateLegalMoves(&t, 3, 4)
	hasEP := false
	for _, m := range pawnMoves {
		if m.Special == SpecialEnPassant {
			hasEP = true
		}
	}
	check("白 e5 兵存在吃过路兵走法", hasEP)

	var epMove Move
	for _, m := range pawnMoves {
		if m.Special == SpecialEnPassant {
			epMove = m
			break
		}
	}
	after := t.Clone()
	ApplyMove(&after, epMove, true)
	check("过路兵吃后白兵位于 d6", after.Board[2][3] == 'P')
	check("过路兵吃后黑 d5 兵被移除", after.Board[3][3] == '.')
	check("过路兵吃后过路兵格已清空", after.EnPassantRow == -1)
}

// ---------- 4. 王车易位 ----------
func testCastling() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][4] = 'K'
	s.Board[7][7] = 'R'
	s.Board[7][0] = 'R'
	s.Board[0][4] = 'k'
	s.CanCastleWK = true
	s.CanCastleWQ = true
	s.CanCastleBK = true
	s.CanCastleBQ = true

	kingMoves := GenerateLegalMoves(&s, 7, 4)
	castleK := false
	castleQ := false
	for _, m := range kingMoves {
		if m.Special == SpecialCastleKingside {
			castleK = true
		}
		if m.Special == SpecialCastleQueenside {
			castleQ = true
		}
	}
	check("白王可短易位", castleK)
	check("白王可长易位", castleQ)

	var mv Move
	for _, m := range GenerateLegalMoves(&s, 7, 4) {
		if m.Special == SpecialCastleKingside {
			mv = m
			break
		}
	}
	after := s.Clone()
	ApplyMove(&after, mv, true)
	check("短易位后白王位于 g1", after.Board[7][6] == 'K')
	check("短易位后白车位于 f1", after.Board[7][5] == 'R')
	check("短易位后 h1 为空", after.Board[7][7] == '.')
	check("短易位后白方失去全部易位权", !after.CanCastleWK && !after.CanCastleWQ)

	blocked := s.Clone()
	blocked.Board[3][3] = 'r' // 黑车 d5，攻击 d1
	km := GenerateLegalMoves(&blocked, 7, 4)
	castleQBlocked := false
	for _, m := range km {
		if m.Special == SpecialCastleQueenside {
			castleQBlocked = true
		}
	}
	check("路径 d1 被攻击时长易位被禁止", !castleQBlocked)

	inCheck := s.Clone()
	inCheck.Board[3][4] = 'r' // 黑车 e5 攻击 e1
	km = GenerateLegalMoves(&inCheck, 7, 4)
	anyCastle := false
	for _, m := range km {
		if m.Special == SpecialCastleKingside || m.Special == SpecialCastleQueenside {
			anyCastle = true
		}
	}
	check("王被将军时禁止易位", !anyCastle)
}

// ---------- 5. 兵升变 ----------
func testPromotion() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[1][4] = 'P'
	s.Board[7][4] = 'K'
	s.Board[0][7] = 'k'

	moves := GenerateLegalMoves(&s, 1, 4)
	promoCount := 0
	for _, m := range moves {
		if m.Special == SpecialPromotion {
			promoCount++
		}
	}
	check("e7 兵生成 4 种升变走法（Q/R/B/N）", promoCount == 4)

	var mv Move
	for _, m := range GenerateLegalMoves(&s, 1, 4) {
		if m.Special == SpecialPromotion && m.Promotion == 'Q' {
			mv = m
			break
		}
	}
	after := s.Clone()
	ApplyMove(&after, mv, true)
	check("升变后 e8 为白后", after.Board[0][4] == 'Q')
	check("升变后 e7 为空", after.Board[1][4] == '.')
}

// ---------- 6. 学者将杀 ----------
func testScholarMate() {
	s := NewGame()
	s = play(s, 6, 4, 4, 4) // 1. e4
	s = play(s, 1, 4, 3, 4) // 1... e5
	s = play(s, 7, 5, 4, 2) // 2. Bf1-c4
	s = play(s, 0, 1, 2, 2) // 2... Nb8-c6
	s = play(s, 7, 3, 3, 7) // 3. Qd1-h5
	s = play(s, 0, 6, 2, 5) // 3... Ng8-f6
	s = play(s, 3, 7, 1, 5) // 4. Qh5xf7#

	check("学者将杀：黑方被将军", IsInCheck(&s, false))
	check("学者将杀：IsCheckmate = True", IsCheckmate(&s))
	check("学者将杀：非逼和", !IsStalemate(&s))
	check("学者将杀后轮黑方", !s.WhiteToMove)
}

// ---------- 7. 愚兄杀 ----------
func testFoolMate() {
	s := NewGame()
	s = play(s, 6, 5, 5, 5) // 1. f3
	s = play(s, 1, 4, 3, 4) // 1... e5
	s = play(s, 6, 6, 4, 6) // 2. g4
	s = play(s, 0, 3, 4, 7) // 2... Qd8-h4#

	check("愚兄杀：白方被将军", IsInCheck(&s, true))
	check("愚兄杀：IsCheckmate = True", IsCheckmate(&s))
}

// ---------- 8. 逼和 ----------
func testStalemate() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[0][7] = 'k' // h8
	s.Board[1][5] = 'Q' // f7
	s.Board[2][6] = 'K' // g6
	s.WhiteToMove = false

	check("逼和局面：黑方不被将军", !IsInCheck(&s, false))
	check("逼和局面：黑方合法走法数 = 0", len(GenerateAllLegalMoves(&s)) == 0)
	check("逼和局面：IsStalemate = True", IsStalemate(&s))
	check("逼和局面：非将死", !IsCheckmate(&s))
}

// ---------- 9. 子力不足 ----------
func testInsufficientMaterial() {
	kk := NewGame()
	emptyBoard(&kk)
	kk.Board[7][4] = 'K'
	kk.Board[0][4] = 'k'
	check("仅剩双王 = 子力不足", IsInsufficientMaterial(&kk))

	kk.Board[4][4] = 'N'
	check("王+单马 vs 王 = 子力不足", IsInsufficientMaterial(&kk))

	kk.Board[4][4] = 'b'
	check("王+单象 vs 王 = 子力不足", IsInsufficientMaterial(&kk))

	kk.Board[4][4] = 'P'
	check("王+兵 vs 王 ≠ 子力不足", !IsInsufficientMaterial(&kk))

	kk.Board[4][4] = 'R'
	check("王+车 vs 王 ≠ 子力不足", !IsInsufficientMaterial(&kk))

	full := NewGame()
	check("初始局面 ≠ 子力不足", !IsInsufficientMaterial(&full))
}

// ---------- 10. 50 步规则计数 ----------
func testFiftyMoveCounter() {
	s := NewGame()
	s = play(s, 7, 6, 5, 5) // 1. Ng1-f3
	check("马走一步后半步计数 = 1", s.HalfmoveClock == 1)
	s = play(s, 0, 6, 2, 5) // 1... Ng8-f6
	check("两步非兵非吃后半步计数 = 2", s.HalfmoveClock == 2)
	s = play(s, 5, 5, 7, 6) // 2. Nf3-g1
	check("三步后半步计数 = 3", s.HalfmoveClock == 3)
	s = play(s, 2, 5, 0, 6) // 2... Nf6-g8
	check("四步后半步计数 = 4", s.HalfmoveClock == 4)
	s = play(s, 6, 4, 4, 4) // 3. e4（动兵清零）
	check("动兵后半步计数清零", s.HalfmoveClock == 0)
	check("未达 100 半步不判 50 步和棋", !IsFiftyMoveDraw(&s))

	forced := NewGame()
	forced.HalfmoveClock = 100
	check("100 半步判 50 步和棋", IsFiftyMoveDraw(&forced))
}

// ---------- 11. 三次重复局面判和 ----------
func testThreefoldRepetition() {
	s := NewGame()
	s = play(s, 7, 6, 5, 5)
	s = play(s, 0, 6, 2, 5)
	s = play(s, 5, 5, 7, 6)
	s = play(s, 2, 5, 0, 6)
	check("4 步往返后局面重复第 2 次（不判和）", !IsThreefoldRepetition(&s))

	s = play(s, 7, 6, 5, 5)
	s = play(s, 0, 6, 2, 5)
	s = play(s, 5, 5, 7, 6)
	s = play(s, 2, 5, 0, 6)
	check("8 步往返后局面重复第 3 次（判和）", IsThreefoldRepetition(&s))

	s = play(s, 6, 4, 4, 4)
	check("走出新局面后不再判和", !IsThreefoldRepetition(&s))
}

// ---------- 12. 评估函数 ----------
func testEvaluation() {
	s := NewGame()
	check("初始局面评估 = 0（对称）", Evaluate(&s) == 0)
	s.Board[4][4] = 'P'
	score1 := Evaluate(&s)
	check("白方多一兵 → 评估为正", score1 > 0)
	s.Board[3][3] = 'n'
	score2 := Evaluate(&s)
	check("黑方多一马压过白方一兵 → 评估为负", score2 < 0)
}

// ---------- 13. Negamax 终局评分 ----------
func testNegamaxTerminalScores() {
	s := NewGame()
	s = play(s, 6, 4, 4, 4)
	s = play(s, 1, 4, 3, 4)
	s = play(s, 7, 5, 4, 2)
	s = play(s, 0, 1, 2, 2)
	s = play(s, 7, 3, 3, 7)
	s = play(s, 0, 6, 2, 5)
	s = play(s, 3, 7, 1, 5) // 4. Qxf7#
	mateScore := Negamax(&s, 2, -Infinity, Infinity, 0)
	check("将死局面 negamax 返回大负数", mateScore <= -9000)

	st := NewGame()
	emptyBoard(&st)
	st.Board[0][7] = 'k'
	st.Board[1][5] = 'Q'
	st.Board[2][6] = 'K'
	st.WhiteToMove = false
	st.PositionKeys = nil
	st.PositionKeys = append(st.PositionKeys, st.GetPositionKey())
	staleScore := Negamax(&st, 2, -Infinity, Infinity, 0)
	check("逼和局面 negamax 返回 0", staleScore == 0)
}

// ---------- 14. AI 一步杀 ----------
func testAIFindsMate() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[2][1] = 'K'
	s.Board[7][7] = 'Q'
	s.Board[0][0] = 'k'
	s.WhiteToMove = true
	s.PositionKeys = nil
	s.PositionKeys = append(s.PositionKeys, s.GetPositionKey())

	best := FindBestMove(&s, 2)
	after := s.Clone()
	ApplyMove(&after, *best, true)
	check("AI 深度 2 找到一步杀（Qh8#）", IsCheckmate(&after))
}

// ---------- 15. AI 白吃无保护后 ----------
func testAICapturesFreeQueen() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][3] = 'Q'
	s.Board[7][4] = 'K'
	s.Board[0][3] = 'q'
	s.Board[0][7] = 'k'
	s.WhiteToMove = true
	s.PositionKeys = nil
	s.PositionKeys = append(s.PositionKeys, s.GetPositionKey())

	best := FindBestMove(&s, 2)
	check("AI 深度 2 捕获无保护黑后",
		best != nil && best.ToRow == 0 && best.ToCol == 3 && best.Captured == 'q')
}

// ---------- 16. AI 开局合理性 ----------
func testAIChooseReasonableOpening() {
	s := NewGame()
	start := time.Now()
	best := FindBestMove(&s, 2)
	elapsed := time.Since(start)
	isLegal := false
	if best != nil {
		for _, m := range GenerateAllLegalMoves(&s) {
			if m.FromRow == best.FromRow && m.FromCol == best.FromCol &&
				m.ToRow == best.ToRow && m.ToCol == best.ToCol {
				isLegal = true
			}
		}
	}
	check("初始局面 AI 返回合法走法", isLegal)
	check("AI 深度 2 初始局面搜索 < 5 秒", elapsed.Milliseconds() < 5000)
}

// ---------- 17. 被钉死棋子限制 ----------
func testPinnedPiece() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][3] = 'K'
	s.Board[6][3] = 'B'
	s.Board[0][3] = 'r'
	s.Board[0][4] = 'k'
	check("钉死前象存在伪合法走法", len(GeneratePseudoMoves(&s, 6, 3)) > 0)
	check("被钉死象无合法走法", len(GenerateLegalMoves(&s, 6, 3)) == 0)
	check("钉死局面白王未被将军", !IsInCheck(&s, true))
}

// ---------- 18. 被将军时合法走法枚举 ----------
func testCheckEvasion() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][4] = 'K'
	s.Board[0][4] = 'r'
	s.Board[0][0] = 'k'
	check("逃将局面白王被将军", IsInCheck(&s, true))
	legal := GenerateAllLegalMoves(&s)
	check("被将军时合法走法均为逃着（>0）", len(legal) > 0)
	allResolve := true
	for _, m := range legal {
		after := s.Clone()
		ApplyMove(&after, m, true)
		if IsInCheck(&after, true) {
			allResolve = false
		}
	}
	check("每个合法走法均解除将军", allResolve)
}

// ---------- 19. 过路兵吃子揭开己方王 ----------
func testEnPassantRevealCheck() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[3][0] = 'K'
	s.Board[3][7] = 'r'
	s.Board[3][3] = 'P'
	s.Board[3][4] = 'p'
	s.WhiteToMove = true
	s.EnPassantRow = 2
	s.EnPassantCol = 4
	s.PositionKeys = nil
	check("EP 揭开将军：当前白王未被将军", !IsInCheck(&s, true))
	legal := GenerateLegalMoves(&s, 3, 3)
	hasEP := false
	for _, m := range legal {
		if m.Special == SpecialEnPassant {
			hasEP = true
		}
	}
	check("EP 吃子会揭开己方王 → 不出现在合法走法中", !hasEP)
}

// ---------- 20. 子力不足扩展 ----------
func testInsufficientMaterialExtended() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][4] = 'K'
	s.Board[0][4] = 'k'
	check("KK = 子力不足", IsInsufficientMaterial(&s))
	s.Board[7][1] = 'N'
	check("KN vs K = 子力不足", IsInsufficientMaterial(&s))
	s.Board[7][2] = 'N'
	check("KNN vs K = 子力不足", IsInsufficientMaterial(&s))

	kb := NewGame()
	emptyBoard(&kb)
	kb.Board[7][4] = 'K'
	kb.Board[0][4] = 'k'
	kb.Board[7][2] = 'B'
	kb.Board[0][3] = 'b'
	check("KB vs KB = 子力不足", IsInsufficientMaterial(&kb))

	kbb := NewGame()
	emptyBoard(&kbb)
	kbb.Board[7][4] = 'K'
	kbb.Board[0][4] = 'k'
	kbb.Board[7][2] = 'B'
	kbb.Board[7][5] = 'B'
	check("KBB 异色格双象可杀 ≠ 子力不足", !IsInsufficientMaterial(&kbb))

	kbn := NewGame()
	emptyBoard(&kbn)
	kbn.Board[7][4] = 'K'
	kbn.Board[0][4] = 'k'
	kbn.Board[7][2] = 'B'
	kbn.Board[7][1] = 'N'
	check("KBN vs K 可杀 ≠ 子力不足", !IsInsufficientMaterial(&kbn))

	kr := NewGame()
	emptyBoard(&kr)
	kr.Board[7][4] = 'K'
	kr.Board[0][4] = 'k'
	kr.Board[7][0] = 'R'
	check("K + 车 vs K 可杀 ≠ 子力不足", !IsInsufficientMaterial(&kr))
}

// ---------- 21. AI 深度 3 性能 ----------
func testDepth3Timing() {
	s := NewGame()
	s = play(s, 6, 4, 4, 4)
	s = play(s, 1, 4, 3, 4)
	s = play(s, 7, 6, 5, 5)
	s = play(s, 0, 1, 2, 2)
	s = play(s, 7, 5, 4, 2)
	s = play(s, 0, 6, 2, 5)
	start := time.Now()
	best := FindBestMove(&s, 3)
	elapsed := time.Since(start)
	isLegal := false
	if best != nil {
		for _, m := range GenerateAllLegalMoves(&s) {
			if m.FromRow == best.FromRow && m.FromCol == best.FromCol &&
				m.ToRow == best.ToRow && m.ToCol == best.ToCol {
				isLegal = true
			}
		}
	}
	check("AI 深度 3 返回合法走法", isLegal)
	check("AI 深度 3 中局搜索 < 2 秒", elapsed.Milliseconds() < 2000)
}

// ---------- 22. 角格车被吃后撤销易位权 ----------
func testCastlingRightRevokedOnRookCapture() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[7][4] = 'K'
	s.Board[7][7] = 'R'
	s.Board[0][7] = 'r'
	s.Board[0][4] = 'k'
	s.WhiteToMove = false
	s.CanCastleWK = true
	s.CanCastleWQ = true
	s.CanCastleBK = true
	s.CanCastleBQ = true

	var move *Move
	for _, m := range GenerateLegalMoves(&s, 0, 7) {
		if m.ToRow == 7 && m.ToCol == 7 {
			mv := m
			move = &mv
		}
	}
	check("黑车可走到 h1 吃掉白车", move != nil)
	after := s.Clone()
	ApplyMove(&after, *move, true)
	check("角格白车被吃后白方失去短易位权", !after.CanCastleWK)
	check("黑车已占领 h1", after.Board[7][7] == 'r')
}

// ---------- 23. 退化局面 ----------
func testDegeneratePositions() {
	empty := NewGame()
	emptyBoard(&empty)
	check("空盘 a1 不被攻击", !IsAttacked(empty.Board, 7, 0, true) && !IsAttacked(empty.Board, 7, 0, false))
	check("空盘 e4 不被攻击", !IsAttacked(empty.Board, 4, 4, true) && !IsAttacked(empty.Board, 4, 4, false))

	kk := NewGame()
	emptyBoard(&kk)
	kk.Board[7][4] = 'K'
	kk.Board[0][4] = 'k'
	bm := FindBestMove(&kk, 1)
	check("K vs K 局面 FindBestMove 有值（王可走）", bm != nil)

	mate := NewGame()
	mate = play(mate, 6, 4, 4, 4)
	mate = play(mate, 1, 4, 3, 4)
	mate = play(mate, 7, 5, 4, 2)
	mate = play(mate, 0, 1, 2, 2)
	mate = play(mate, 7, 3, 3, 7)
	mate = play(mate, 0, 6, 2, 5)
	mate = play(mate, 3, 7, 1, 5) // Qxf7#
	mateMove := FindBestMove(&mate, 1)
	check("将死局面 FindBestMove = Nothing", mateMove == nil)
}

// ---------- 24. 升变 SAN 记谱 ----------
func testPromotionSAN() {
	s := NewGame()
	emptyBoard(&s)
	s.Board[1][4] = 'P'
	s.Board[7][4] = 'K'
	s.Board[0][7] = 'k'
	var qmove *Move
	for _, m := range GenerateLegalMoves(&s, 1, 4) {
		if m.Special == SpecialPromotion && m.Promotion == 'Q' {
			mv := m
			qmove = &mv
		}
	}
	check("升后走法存在", qmove != nil)
	if qmove != nil {
		check("升变 SAN 含 =Q", strings.Contains(qmove.String(), "=Q"))
		check("升变 SAN = e8=Q", qmove.String() == "e8=Q")
	}
}

// RunTests 运行全部测试，返回失败数（0 = 全绿）
func RunTests() int {
	testPass = 0
	testFail = 0
	testInitialPosition()
	testIsAttackedBasics()
	testPawnDoubleAndEnPassant()
	testCastling()
	testPromotion()
	testScholarMate()
	testFoolMate()
	testStalemate()
	testInsufficientMaterial()
	testFiftyMoveCounter()
	testThreefoldRepetition()
	testEvaluation()
	testNegamaxTerminalScores()
	testAIFindsMate()
	testAICapturesFreeQueen()
	testAIChooseReasonableOpening()
	testPinnedPiece()
	testCheckEvasion()
	testEnPassantRevealCheck()
	testInsufficientMaterialExtended()
	testDepth3Timing()
	testCastlingRightRevokedOnRookCapture()
	testDegeneratePositions()
	testPromotionSAN()
	testPerft()

	fmt.Println()
	fmt.Println("========================================")
	fmt.Printf("RESULT: %d passed, %d failed\n", testPass, testFail)
	fmt.Println("========================================")
	return testFail
}
