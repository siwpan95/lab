// =============================================================================
// chess_ai.go — AI 对弈引擎（Go，与 C++ 参考对齐）
// 架构：评估层（子力价值 + PST）+ 搜索层（negamax + alpha-beta + 走法排序 + 静态搜索）
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// =============================================================================

package main

import "sort"

// ---------------------------- 常量 ----------------------------
const (
	MateScore = 900000
	Infinity  = 1000000
	// RepetitionPenalty：当某个叶局面的 engine.mjs 兼容键出现在 RepHistory（本局
	// 此前见过的局面）中时，按出现次数扣分（白方视角）。目的是引导搜索远离会把
	// 对局带回重复局面的走法，从而减少三重复和棋。取值约半兵，足够影响平手选择、
	// 又不至于让引擎为了避重而白白弃子。
	RepetitionPenalty = 60
)

// ---------------------------- 子力价值（厘兵单位） ----------------------------
// 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
var PieceValue = [7]int{0, 100, 320, 330, 500, 900, 0}

// ---------------------------- 位置价值表 PST（白方视角，逐字复制 C++） ----------------------------
var PSTPawn = [64]int{
	0, 0, 0, 0, 0, 0, 0, 0,
	50, 50, 50, 50, 50, 50, 50, 50,
	10, 10, 20, 30, 30, 20, 10, 10,
	5, 5, 10, 25, 25, 10, 5, 5,
	0, 0, 0, 20, 20, 0, 0, 0,
	5, -5, -10, 0, 0, -10, -5, 5,
	5, 10, 10, -20, -20, 10, 10, 5,
	0, 0, 0, 0, 0, 0, 0, 0,
}

var PSTKnight = [64]int{
	-50, -40, -30, -30, -30, -30, -40, -50,
	-40, -20, 0, 0, 0, 0, -20, -40,
	-30, 0, 10, 15, 15, 10, 0, -30,
	-30, 5, 15, 20, 20, 15, 5, -30,
	-30, 0, 15, 20, 20, 15, 0, -30,
	-30, 5, 10, 15, 15, 10, 5, -30,
	-40, -20, 0, 5, 5, 0, -20, -40,
	-50, -40, -30, -30, -30, -30, -40, -50,
}

var PSTBishop = [64]int{
	-20, -10, -10, -10, -10, -10, -10, -20,
	-10, 0, 0, 0, 0, 0, 0, -10,
	-10, 0, 5, 10, 10, 5, 0, -10,
	-10, 5, 5, 10, 10, 5, 5, -10,
	-10, 0, 10, 10, 10, 10, 0, -10,
	-10, 10, 10, 10, 10, 10, 10, -10,
	-10, 5, 0, 0, 0, 0, 5, -10,
	-20, -10, -10, -10, -10, -10, -10, -20,
}

var PSTRook = [64]int{
	0, 0, 0, 0, 0, 0, 0, 0,
	5, 10, 10, 10, 10, 10, 10, 5,
	-5, 0, 0, 0, 0, 0, 0, -5,
	-5, 0, 0, 0, 0, 0, 0, -5,
	-5, 0, 0, 0, 0, 0, 0, -5,
	-5, 0, 0, 0, 0, 0, 0, -5,
	-5, 0, 0, 0, 0, 0, 0, -5,
	0, 0, 0, 5, 5, 0, 0, 0,
}

var PSTQueen = [64]int{
	-20, -10, -10, -5, -5, -10, -10, -20,
	-10, 0, 0, 0, 0, 0, 0, -10,
	-10, 0, 5, 5, 5, 5, 0, -10,
	-5, 0, 5, 5, 5, 5, 0, -5,
	0, 0, 5, 5, 5, 5, 0, -5,
	-10, 5, 5, 5, 5, 5, 0, -10,
	-10, 0, 5, 0, 0, 0, 0, -10,
	-20, -10, -10, -5, -5, -10, -10, -20,
}

var PSTKing = [64]int{
	-30, -40, -40, -50, -50, -40, -40, -30,
	-30, -40, -40, -50, -50, -40, -40, -30,
	-30, -40, -40, -50, -50, -40, -40, -30,
	-30, -40, -40, -50, -50, -40, -40, -30,
	-20, -30, -30, -40, -40, -30, -30, -20,
	-10, -20, -20, -20, -20, -20, -20, -10,
	20, 20, 0, 0, 0, 0, 20, 20,
	20, 30, 10, 0, 0, 10, 30, 20,
}

// ---------------------------- 内部工具 ----------------------------
func PieceIndex(p byte) int {
	switch toUpper(p) {
	case 'P':
		return 1
	case 'N':
		return 2
	case 'B':
		return 3
	case 'R':
		return 4
	case 'Q':
		return 5
	case 'K':
		return 6
	default:
		return 0
	}
}

func GetPST(idx, pos int) int {
	switch idx {
	case 1:
		return PSTPawn[pos]
	case 2:
		return PSTKnight[pos]
	case 3:
		return PSTBishop[pos]
	case 4:
		return PSTRook[pos]
	case 5:
		return PSTQueen[pos]
	case 6:
		return PSTKing[pos]
	default:
		return 0
	}
}

// ---------------------------- 局面评估（白方视角） ----------------------------
func Evaluate(state *GameState) int {
	score := 0
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			p := state.Board[r][c]
			if p == '.' {
				continue
			}
			idx := PieceIndex(p)
			pos := r*8 + c
			if isUpper(p) {
				score += PieceValue[idx] + GetPST(idx, pos)
			} else {
				score -= PieceValue[idx] + GetPST(idx, (7-r)*8+c)
			}
		}
	}
	// 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
	if state.RepHistory != nil {
		if cnt, ok := state.RepHistory[state.PositionKeySimple()]; ok && cnt > 0 {
			score -= RepetitionPenalty * cnt
		}
	}
	return score
}

// evaluateSide 返回当前行棋方视角分数（negamax 约定）
func evaluateSide(state *GameState) int {
	s := Evaluate(state)
	if state.WhiteToMove {
		return s
	}
	return -s
}

// ---------------------------- 走法排序（MVV-LVA） ----------------------------
func MoveOrderScore(m Move) int {
	if m.Captured == '.' {
		return 0
	}
	victim := PieceValue[PieceIndex(m.Captured)]
	attacker := PieceValue[PieceIndex(m.Piece)]
	return victim*10 - attacker
}

func OrderMoves(moves []Move) {
	sort.Slice(moves, func(i, j int) bool {
		return MoveOrderScore(moves[i]) > MoveOrderScore(moves[j])
	})
}

// ---------------------------- 静态搜索（quiescence） ----------------------------
func Quiescence(state *GameState, alpha, beta, qdepth int) int {
	stand := evaluateSide(state)
	if stand >= beta {
		return beta
	}
	if stand > alpha {
		alpha = stand
	}
	if qdepth >= 4 {
		return alpha
	}

	var captures []Move
	for _, m := range GenerateAllLegalMoves(state) {
		if m.Captured != '.' {
			captures = append(captures, m)
		}
	}
	OrderMoves(captures)

	for _, m := range captures {
		child := state.CloneLight()
		ApplyMove(&child, m, false)
		score := -Quiescence(&child, -beta, -alpha, qdepth+1)
		if score >= beta {
			return beta
		}
		if score > alpha {
			alpha = score
		}
	}
	return alpha
}

// ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
func Negamax(state *GameState, depth, alpha, beta, ply int) int {
	moves := GenerateAllLegalMoves(state)
	if len(moves) == 0 {
		if IsInCheck(state, state.WhiteToMove) {
			return -MateScore + ply // 被将死：离根越近越差
		}
		return 0 // 逼和
	}
	if depth <= 0 {
		return Quiescence(state, alpha, beta, 0)
	}

	OrderMoves(moves)

	best := -Infinity
	for _, m := range moves {
		child := state.CloneLight()
		ApplyMove(&child, m, false)
		score := -Negamax(&child, depth-1, -beta, -alpha, ply+1)
		if score > best {
			best = score
		}
		if best > alpha {
			alpha = best
		}
		if alpha >= beta {
			break
		}
	}
	return best
}

// ---------------------------- 对外接口：求最佳走法 ----------------------------
// 无合法走法返回 nil；仅一步直接返回；否则 alpha-beta 搜索取最优。
func FindBestMove(state *GameState, depth int) *Move {
	moves := GenerateAllLegalMoves(state)
	if len(moves) == 0 {
		return nil
	}
	if len(moves) == 1 {
		m := moves[0]
		res := m
		return &res
	}

	OrderMoves(moves)

	bestScore := -Infinity
	alpha := -Infinity
	beta := Infinity
	var bestMove Move
	for _, m := range moves {
		child := state.CloneLight()
		ApplyMove(&child, m, false)
		score := -Negamax(&child, depth-1, -beta, -alpha, 1)
		if score > bestScore {
			bestScore = score
			bestMove = m
		}
		if score > alpha {
			alpha = score
		}
	}
	res := bestMove
	return &res
}
