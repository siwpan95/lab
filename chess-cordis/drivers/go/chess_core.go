// =============================================================================
// chess_core.go — 国际象棋核心引擎（Go，与 C++ 参考对齐）
// -----------------------------------------------------------------------------
// 棋盘：board[row][col]
//   row 0 = 第 8 横线（黑方底线，屏幕上方）；row 7 = 第 1 横线（白方底线，下方）
//   col 0..7 = a..h；大写 = 白方，小写 = 黑方；'.' = 空格
// =============================================================================

package main

import (
	"strconv"
	"strings"
)

// ---------------------------- 特殊走法类型 ----------------------------
type SpecialMove int

const (
	SpecialNone            SpecialMove = 0
	SpecialDoublePawn      SpecialMove = 1
	SpecialEnPassant       SpecialMove = 2
	SpecialCastleKingside  SpecialMove = 3
	SpecialCastleQueenside SpecialMove = 4
	SpecialPromotion       SpecialMove = 5
)

// ---------------------------- 走法结构 ----------------------------
type Move struct {
	FromRow   int
	FromCol   int
	ToRow     int
	ToCol     int
	Piece     byte
	Captured  byte
	Special   SpecialMove
	Promotion byte
}

func (m Move) isCapture() bool { return m.Captured != '.' }

// String 返回长式代数记谱（无歧义），与 C++ Move::toString 完全一致
func (m Move) String() string {
	if m.Special == SpecialCastleKingside {
		return "O-O"
	}
	if m.Special == SpecialCastleQueenside {
		return "O-O-O"
	}
	files := "abcdefgh"
	fromSq := string(files[m.FromCol]) + string('0'+byte(8-m.FromRow))
	toSq := string(files[m.ToCol]) + string('0'+byte(8-m.ToRow))
	if m.Piece == 'P' || m.Piece == 'p' {
		var s strings.Builder
		if m.isCapture() {
			s.WriteByte(files[m.FromCol])
		}
		s.WriteString(toSq)
		if m.Special == SpecialPromotion {
			s.WriteByte('=')
			s.WriteByte(toUpper(m.Promotion))
		}
		return s.String()
	}
	var s strings.Builder
	s.WriteByte(toUpper(m.Piece))
	s.WriteString(fromSq)
	if m.isCapture() {
		s.WriteByte('x')
	}
	s.WriteString(toSq)
	return s.String()
}

// ---------------------------- 对局状态 ----------------------------
type GameState struct {
	Board            [8][8]byte
	WhiteToMove      bool
	CanCastleWK      bool
	CanCastleWQ      bool
	CanCastleBK      bool
	CanCastleBQ      bool
	EnPassantRow     int
	EnPassantCol     int
	HalfmoveClock    int
	FullmoveNumber   int
	History          []string
	PositionKeys     []string
	// RepHistory: runner-supplied position keys seen so far this game (engine.mjs
	// keys), used by the repetition penalty in chess_ai.go. nil ⇒ no penalty.
	RepHistory map[string]int
}

// NewGame 返回初始化为开局局面的 GameState（对齐 C++ 默认构造函数）
func NewGame() GameState {
	var s GameState
	s.ResetToStartPosition()
	return s
}

func (s *GameState) ResetToStartPosition() {
	back := "rnbqkbnr"
	for c := 0; c < 8; c++ {
		s.Board[0][c] = back[c]
		s.Board[1][c] = 'p'
		s.Board[2][c] = '.'
		s.Board[3][c] = '.'
		s.Board[4][c] = '.'
		s.Board[5][c] = '.'
		s.Board[6][c] = 'P'
		s.Board[7][c] = toUpper(byte(back[c]))
	}
	s.WhiteToMove = true
	s.CanCastleWK = true
	s.CanCastleWQ = true
	s.CanCastleBK = true
	s.CanCastleBQ = true
	s.EnPassantRow = -1
	s.EnPassantCol = -1
	s.HalfmoveClock = 0
	s.FullmoveNumber = 1
	s.History = nil
	s.PositionKeys = nil
	s.PositionKeys = append(s.PositionKeys, s.GetPositionKey())
}

// GetPositionKey 局面键：64 格 + 行棋方 + 四方易位权 + （合法则）过路兵格
func (s *GameState) GetPositionKey() string {
	var sb strings.Builder
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			sb.WriteByte(s.Board[r][c])
		}
	}
	if s.WhiteToMove {
		sb.WriteByte('w')
	} else {
		sb.WriteByte('b')
	}
	if s.CanCastleWK {
		sb.WriteByte('K')
	} else {
		sb.WriteByte('-')
	}
	if s.CanCastleWQ {
		sb.WriteByte('Q')
	} else {
		sb.WriteByte('-')
	}
	if s.CanCastleBK {
		sb.WriteByte('k')
	} else {
		sb.WriteByte('-')
	}
	if s.CanCastleBQ {
		sb.WriteByte('q')
	} else {
		sb.WriteByte('-')
	}
	if HasLegalEnPassant(s) {
		sb.WriteString(strconv.Itoa(s.EnPassantRow))
		sb.WriteByte(',')
		sb.WriteString(strconv.Itoa(s.EnPassantCol))
	} else {
		sb.WriteString("-1,-1")
	}
	return sb.String()
}

// PositionKeySimple 返回与 engine.mjs 的 getPositionKey 完全一致的局面键：
//   · 易位权不加 '-' 分隔符（KQkq 直接拼接）
//   · 过路兵用存储值（EnPassantRow/Col），不调用 HasLegalEnPassant
// 重复惩罚在评估层比对 runner 传来的历史键（也是 engine.mjs 键），
// 所以必须保证两边键格式一致，否则惩罚永远不会触发。
func (s *GameState) PositionKeySimple() string {
	var sb strings.Builder
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			sb.WriteByte(s.Board[r][c])
		}
	}
	if s.WhiteToMove {
		sb.WriteByte('w')
	} else {
		sb.WriteByte('b')
	}
	if s.CanCastleWK {
		sb.WriteByte('K')
	}
	if s.CanCastleWQ {
		sb.WriteByte('Q')
	}
	if s.CanCastleBK {
		sb.WriteByte('k')
	}
	if s.CanCastleBQ {
		sb.WriteByte('q')
	}
	if s.EnPassantRow >= 0 && s.EnPassantCol >= 0 {
		sb.WriteString(strconv.Itoa(s.EnPassantRow))
		sb.WriteByte(',')
		sb.WriteString(strconv.Itoa(s.EnPassantCol))
	} else {
		sb.WriteString("-1,-1")
	}
	return sb.String()
}

// Clone 深拷贝全部字段（含 history / positionKeys）
func (s *GameState) Clone() GameState {
	var n GameState
	n.Board = s.Board
	n.WhiteToMove = s.WhiteToMove
	n.CanCastleWK = s.CanCastleWK
	n.CanCastleWQ = s.CanCastleWQ
	n.CanCastleBK = s.CanCastleBK
	n.CanCastleBQ = s.CanCastleBQ
	n.EnPassantRow = s.EnPassantRow
	n.EnPassantCol = s.EnPassantCol
	n.HalfmoveClock = s.HalfmoveClock
	n.FullmoveNumber = s.FullmoveNumber
	n.History = append([]string(nil), s.History...)
	n.PositionKeys = append([]string(nil), s.PositionKeys...)
	n.RepHistory = s.RepHistory // shared read-only during search
	return n
}

// CloneLight 轻量克隆（AI 搜索专用：跳过 history / positionKeys）
func (s *GameState) CloneLight() GameState {
	var n GameState
	n.Board = s.Board
	n.WhiteToMove = s.WhiteToMove
	n.CanCastleWK = s.CanCastleWK
	n.CanCastleWQ = s.CanCastleWQ
	n.CanCastleBK = s.CanCastleBK
	n.CanCastleBQ = s.CanCastleBQ
	n.EnPassantRow = s.EnPassantRow
	n.EnPassantCol = s.EnPassantCol
	n.HalfmoveClock = s.HalfmoveClock
	n.FullmoveNumber = s.FullmoveNumber
	n.RepHistory = s.RepHistory // shared read-only during search
	return n
}

// ---------------------------- 基础工具 ----------------------------
func InBoard(r, c int) bool { return r >= 0 && r <= 7 && c >= 0 && c <= 7 }

func IsWhitePiece(p byte) bool { return p != '.' && isUpper(p) }
func IsBlackPiece(p byte) bool { return p != '.' && isLower(p) }
func IsPieceOfSide(p byte, white bool) bool {
	if p == '.' {
		return false
	}
	return white && isUpper(p) || (!white && isLower(p))
}

// ---------------------------- IsAttacked ----------------------------
func IsAttacked(board [8][8]byte, r, c int, byWhite bool) bool {
	pawn := byte('P')
	if !byWhite {
		pawn = 'p'
	}
	pr := r + 1
	if !byWhite {
		pr = r - 1
	}
	if pr >= 0 && pr <= 7 {
		if c-1 >= 0 && board[pr][c-1] == pawn {
			return true
		}
		if c+1 <= 7 && board[pr][c+1] == pawn {
			return true
		}
	}

	knight := byte('N')
	if !byWhite {
		knight = 'n'
	}
	dr2 := []int{-2, -2, -1, -1, 1, 1, 2, 2}
	dc2 := []int{-1, 1, -2, 2, -2, 2, -1, 1}
	for i := 0; i < 8; i++ {
		tr := r + dr2[i]
		tc := c + dc2[i]
		if InBoard(tr, tc) && board[tr][tc] == knight {
			return true
		}
	}

	king := byte('K')
	if !byWhite {
		king = 'k'
	}
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if dr == 0 && dc == 0 {
				continue
			}
			tr := r + dr
			tc := c + dc
			if InBoard(tr, tc) && board[tr][tc] == king {
				return true
			}
		}
	}

	rook := byte('R')
	queen := byte('Q')
	bishop := byte('B')
	if !byWhite {
		rook = 'r'
		queen = 'q'
		bishop = 'b'
	}
	dirR := []int{-1, 1, 0, 0, -1, -1, 1, 1}
	dirC := []int{0, 0, -1, 1, -1, 1, -1, 1}
	for i := 0; i < 8; i++ {
		tr := r + dirR[i]
		tc := c + dirC[i]
		for InBoard(tr, tc) {
			p := board[tr][tc]
			if p != '.' {
				if i < 4 {
					if p == rook || p == queen {
						return true
					}
				} else {
					if p == bishop || p == queen {
						return true
					}
				}
				break
			}
			tr += dirR[i]
			tc += dirC[i]
		}
	}
	return false
}

// ---------------------------- 兵走法 ----------------------------
func generatePawnMoves(list *[]Move, state *GameState, r, c int, isWhite bool, enemyPawn byte) {
	board := state.Board
	dir := -1
	if !isWhite {
		dir = 1
	}
	startRow := 6
	if !isWhite {
		startRow = 1
	}

	if InBoard(r+dir, c) && board[r+dir][c] == '.' {
		addPawnMove(list, r, c, r+dir, c, '.', SpecialNone, isWhite)
		if r == startRow && board[r+2*dir][c] == '.' {
			*list = append(*list, Move{
				FromRow: r, FromCol: c, ToRow: r + 2*dir, ToCol: c,
				Piece: board[r][c], Captured: '.', Special: SpecialDoublePawn, Promotion: '.',
			})
		}
	}

	dcs := []int{-1, 1}
	for _, dc := range dcs {
		tr := r + dir
		tc := c + dc
		if !InBoard(tr, tc) {
			continue
		}
		target := board[tr][tc]
		if target != '.' && IsPieceOfSide(target, !isWhite) {
			addPawnMove(list, r, c, tr, tc, target, SpecialNone, isWhite)
		} else if tr == state.EnPassantRow && tc == state.EnPassantCol {
			addPawnMove(list, r, c, tr, tc, enemyPawn, SpecialEnPassant, isWhite)
		}
	}
}

func addPawnMove(list *[]Move, fr, fc, tr, tc int, captured byte, special SpecialMove, isWhite bool) {
	if tr == 0 || tr == 7 {
		promos := "QRBN"
		for i := 0; i < 4; i++ {
			promo := promos[i]
			if !isWhite {
				promo = toLower(promo)
			}
			*list = append(*list, Move{
				FromRow: fr, FromCol: fc, ToRow: tr, ToCol: tc,
				Piece: pieceFor(isWhite), Captured: captured, Special: SpecialPromotion, Promotion: promo,
			})
		}
	} else {
		*list = append(*list, Move{
			FromRow: fr, FromCol: fc, ToRow: tr, ToCol: tc,
			Piece: pieceFor(isWhite), Captured: captured, Special: special, Promotion: '.',
		})
	}
}

// ---------------------------- 马/王固定偏移 ----------------------------
func generateOffsetMoves(list *[]Move, board [8][8]byte, r, c int, isWhite bool, dr, dc []int) {
	p := board[r][c]
	n := len(dr)
	for i := 0; i < n; i++ {
		tr := r + dr[i]
		tc := c + dc[i]
		if !InBoard(tr, tc) {
			continue
		}
		target := board[tr][tc]
		if target == '.' || IsPieceOfSide(target, !isWhite) {
			*list = append(*list, Move{
				FromRow: r, FromCol: c, ToRow: tr, ToCol: tc,
				Piece: p, Captured: target, Special: SpecialNone, Promotion: '.',
			})
		}
	}
}

// ---------------------------- 象/车/后滑动 ----------------------------
func generateSlidingMoves(list *[]Move, board [8][8]byte, r, c int, isWhite bool, dr, dc []int) {
	p := board[r][c]
	n := len(dr)
	for i := 0; i < n; i++ {
		tr := r + dr[i]
		tc := c + dc[i]
		for InBoard(tr, tc) {
			target := board[tr][tc]
			if target == '.' {
				*list = append(*list, Move{
					FromRow: r, FromCol: c, ToRow: tr, ToCol: tc,
					Piece: p, Captured: '.', Special: SpecialNone, Promotion: '.',
				})
			} else {
				if IsPieceOfSide(target, !isWhite) {
					*list = append(*list, Move{
						FromRow: r, FromCol: c, ToRow: tr, ToCol: tc,
						Piece: p, Captured: target, Special: SpecialNone, Promotion: '.',
					})
				}
				break
			}
			tr += dr[i]
			tc += dc[i]
		}
	}
}

// ---------------------------- 王车易位 ----------------------------
func generateCastlingMoves(list *[]Move, state *GameState, r, c int, isWhite bool) {
	board := state.Board
	if isWhite {
		if r != 7 || c != 4 {
			return
		}
		if state.CanCastleWK && board[7][7] == 'R' && board[7][5] == '.' && board[7][6] == '.' {
			if !IsAttacked(board, 7, 4, false) && !IsAttacked(board, 7, 5, false) && !IsAttacked(board, 7, 6, false) {
				*list = append(*list, Move{
					FromRow: 7, FromCol: 4, ToRow: 7, ToCol: 6,
					Piece: 'K', Captured: '.', Special: SpecialCastleKingside, Promotion: '.',
				})
			}
		}
		if state.CanCastleWQ && board[7][0] == 'R' && board[7][1] == '.' && board[7][2] == '.' && board[7][3] == '.' {
			if !IsAttacked(board, 7, 4, false) && !IsAttacked(board, 7, 3, false) && !IsAttacked(board, 7, 2, false) {
				*list = append(*list, Move{
					FromRow: 7, FromCol: 4, ToRow: 7, ToCol: 2,
					Piece: 'K', Captured: '.', Special: SpecialCastleQueenside, Promotion: '.',
				})
			}
		}
	} else {
		if r != 0 || c != 4 {
			return
		}
		if state.CanCastleBK && board[0][7] == 'r' && board[0][5] == '.' && board[0][6] == '.' {
			if !IsAttacked(board, 0, 4, true) && !IsAttacked(board, 0, 5, true) && !IsAttacked(board, 0, 6, true) {
				*list = append(*list, Move{
					FromRow: 0, FromCol: 4, ToRow: 0, ToCol: 6,
					Piece: 'k', Captured: '.', Special: SpecialCastleKingside, Promotion: '.',
				})
			}
		}
		if state.CanCastleBQ && board[0][0] == 'r' && board[0][1] == '.' && board[0][2] == '.' && board[0][3] == '.' {
			if !IsAttacked(board, 0, 4, true) && !IsAttacked(board, 0, 3, true) && !IsAttacked(board, 0, 2, true) {
				*list = append(*list, Move{
					FromRow: 0, FromCol: 4, ToRow: 0, ToCol: 2,
					Piece: 'k', Captured: '.', Special: SpecialCastleQueenside, Promotion: '.',
				})
			}
		}
	}
}

// ---------------------------- 伪合法走法生成入口 ----------------------------
func GeneratePseudoMoves(state *GameState, r, c int) []Move {
	var list []Move
	board := state.Board
	p := board[r][c]
	if p == '.' {
		return list
	}
	isWhite := isUpper(p)
	enemyPawn := byte('p')
	if isWhite {
		enemyPawn = 'P'
	}
	switch toUpper(p) {
	case 'P':
		generatePawnMoves(&list, state, r, c, isWhite, enemyPawn)
	case 'N':
		dr := []int{-2, -2, -1, -1, 1, 1, 2, 2}
		dc := []int{-1, 1, -2, 2, -2, 2, -1, 1}
		generateOffsetMoves(&list, board, r, c, isWhite, dr, dc)
	case 'K':
		dr := []int{-1, -1, -1, 0, 0, 1, 1, 1}
		dc := []int{-1, 0, 1, -1, 1, -1, 0, 1}
		generateOffsetMoves(&list, board, r, c, isWhite, dr, dc)
		generateCastlingMoves(&list, state, r, c, isWhite)
	case 'B':
		dr := []int{-1, -1, 1, 1}
		dc := []int{-1, 1, -1, 1}
		generateSlidingMoves(&list, board, r, c, isWhite, dr, dc)
	case 'R':
		dr := []int{-1, 1, 0, 0}
		dc := []int{0, 0, -1, 1}
		generateSlidingMoves(&list, board, r, c, isWhite, dr, dc)
	case 'Q':
		dr := []int{-1, 1, 0, 0, -1, -1, 1, 1}
		dc := []int{0, 0, -1, 1, -1, 1, -1, 1}
		generateSlidingMoves(&list, board, r, c, isWhite, dr, dc)
	}
	return list
}

// ---------------------------- 合法走法（两阶段） ----------------------------
func GenerateLegalMoves(state *GameState, r, c int) []Move {
	var legal []Move
	pseudo := GeneratePseudoMoves(state, r, c)
	if len(pseudo) == 0 {
		return legal
	}
	moverIsWhite := isUpper(state.Board[r][c])
	for _, m := range pseudo {
		sim := state.CloneLight()
		ApplyMove(&sim, m, false)
		kr, kc := FindKing(sim.Board, moverIsWhite)
		if !IsAttacked(sim.Board, kr, kc, !moverIsWhite) {
			legal = append(legal, m)
		}
	}
	return legal
}

func GenerateAllLegalMoves(state *GameState) []Move {
	var all []Move
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			if IsPieceOfSide(state.Board[r][c], state.WhiteToMove) {
				all = append(all, GenerateLegalMoves(state, r, c)...)
			}
		}
	}
	return all
}

// ---------------------------- 走子执行 ----------------------------
func ApplyMove(state *GameState, m Move, recordHistory bool) {
	board := &state.Board

	board[m.ToRow][m.ToCol] = m.Piece
	board[m.FromRow][m.FromCol] = '.'

	switch m.Special {
	case SpecialDoublePawn:
		state.EnPassantRow = (m.FromRow + m.ToRow) / 2
		state.EnPassantCol = m.FromCol
	case SpecialEnPassant:
		capRow := m.ToRow + 1
		if m.Piece != 'P' {
			capRow = m.ToRow - 1
		}
		board[capRow][m.ToCol] = '.'
	case SpecialCastleKingside:
		board[m.FromRow][5] = board[m.FromRow][7]
		board[m.FromRow][7] = '.'
	case SpecialCastleQueenside:
		board[m.FromRow][3] = board[m.FromRow][0]
		board[m.FromRow][0] = '.'
	case SpecialPromotion:
		board[m.ToRow][m.ToCol] = m.Promotion
	}

	if m.Special != SpecialDoublePawn {
		state.EnPassantRow = -1
		state.EnPassantCol = -1
	}

	if m.Piece == 'K' {
		state.CanCastleWK = false
		state.CanCastleWQ = false
	} else if m.Piece == 'k' {
		state.CanCastleBK = false
		state.CanCastleBQ = false
	}
	if (m.FromRow == 7 && m.FromCol == 0) || (m.ToRow == 7 && m.ToCol == 0) {
		state.CanCastleWQ = false
	}
	if (m.FromRow == 7 && m.FromCol == 7) || (m.ToRow == 7 && m.ToCol == 7) {
		state.CanCastleWK = false
	}
	if (m.FromRow == 0 && m.FromCol == 0) || (m.ToRow == 0 && m.ToCol == 0) {
		state.CanCastleBQ = false
	}
	if (m.FromRow == 0 && m.FromCol == 7) || (m.ToRow == 0 && m.ToCol == 7) {
		state.CanCastleBK = false
	}

	if toUpper(m.Piece) == 'P' || m.Captured != '.' {
		state.HalfmoveClock = 0
	} else {
		state.HalfmoveClock++
	}

	if !state.WhiteToMove {
		state.FullmoveNumber++
	}
	state.WhiteToMove = !state.WhiteToMove

	if recordHistory {
		state.History = append(state.History, m.String())
		state.PositionKeys = append(state.PositionKeys, state.GetPositionKey())
	}
}

// ---------------------------- 王定位与将军检测 ----------------------------
func FindKing(board [8][8]byte, isWhite bool) (int, int) {
	k := byte('k')
	if isWhite {
		k = 'K'
	}
	for i := 0; i < 8; i++ {
		for j := 0; j < 8; j++ {
			if board[i][j] == k {
				return i, j
			}
		}
	}
	return -1, -1
}

func IsInCheck(state *GameState, isWhite bool) bool {
	kr, kc := FindKing(state.Board, isWhite)
	if kr < 0 {
		return false
	}
	return IsAttacked(state.Board, kr, kc, !isWhite)
}

// ---------------------------- 终局判定 ----------------------------
func IsCheckmate(state *GameState) bool {
	return IsInCheck(state, state.WhiteToMove) && len(GenerateAllLegalMoves(state)) == 0
}
func IsStalemate(state *GameState) bool {
	return !IsInCheck(state, state.WhiteToMove) && len(GenerateAllLegalMoves(state)) == 0
}
func IsFiftyMoveDraw(state *GameState) bool {
	return state.HalfmoveClock >= 100
}

func HasLegalEnPassant(state *GameState) bool {
	if state.EnPassantRow < 0 {
		return false
	}
	pawnRank := state.EnPassantRow + 1
	if !state.WhiteToMove {
		pawnRank = state.EnPassantRow - 1
	}
	if pawnRank < 0 || pawnRank > 7 {
		return false
	}
	pawn := byte('P')
	if !state.WhiteToMove {
		pawn = 'p'
	}
	for dc := -1; dc <= 1; dc += 2 {
		c := state.EnPassantCol + dc
		if c < 0 || c > 7 {
			continue
		}
		if state.Board[pawnRank][c] == pawn {
			for _, m := range GenerateLegalMoves(state, pawnRank, c) {
				if m.Special == SpecialEnPassant {
					return true
				}
			}
		}
	}
	return false
}

func IsThreefoldRepetition(state *GameState) bool {
	if len(state.PositionKeys) == 0 {
		return false
	}
	cur := state.PositionKeys[len(state.PositionKeys)-1]
	count := 0
	for _, k := range state.PositionKeys {
		if k == cur {
			count++
		}
	}
	return count >= 3
}

func IsInsufficientMaterial(state *GameState) bool {
	type piecePos struct {
		p   byte
		pos int
	}
	var white, black []piecePos
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			p := state.Board[r][c]
			if p == '.' || toUpper(p) == 'K' {
				continue
			}
			up := toUpper(p)
			if up == 'P' || up == 'R' || up == 'Q' {
				return false
			}
			if isUpper(p) {
				white = append(white, piecePos{p, r*8 + c})
			} else {
				black = append(black, piecePos{p, r*8 + c})
			}
		}
	}
	total := len(white) + len(black)
	if total == 0 {
		return true
	}
	if total == 1 {
		return true
	}
	if total == 2 {
		if len(white) == 1 && len(black) == 1 {
			return true
		}
		var side []piecePos
		if len(white) == 2 {
			side = white
		} else {
			side = black
		}
		a := toUpper(side[0].p)
		b := toUpper(side[1].p)
		if a == 'B' && b == 'B' {
			color0 := (side[0].pos/8 + side[0].pos%8) % 2
			color1 := (side[1].pos/8 + side[1].pos%8) % 2
			return color0 == color1
		}
		if a == 'N' && b == 'N' {
			return true
		}
		return false
	}
	return false
}

// ---------------------------- byte 辅助 ----------------------------
func isUpper(b byte) bool { return b >= 'A' && b <= 'Z' }
func isLower(b byte) bool { return b >= 'a' && b <= 'z' }
func toUpper(b byte) byte {
	if b >= 'a' && b <= 'z' {
		return b - 'a' + 'A'
	}
	return b
}
func toLower(b byte) byte {
	if b >= 'A' && b <= 'Z' {
		return b - 'A' + 'a'
	}
	return b
}
func pieceFor(isWhite bool) byte {
	if isWhite {
		return 'P'
	}
	return 'p'
}
