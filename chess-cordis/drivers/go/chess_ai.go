// =============================================================================
// chess_ai.go — AI 对弈引擎（Go，与 C++ 参考对齐）
// 架构：评估层（子力价值 + PST）+ 搜索层（negamax + alpha-beta + 走法排序 + 静态搜索）
// 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
// =============================================================================

package main

import (
	"fmt"
	"sort"
	"time"
)

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

// ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
// 与 JsChess/chessAI.js 的 EVAL_PROFILE 同构：每引擎一份独立 profile，术语全部是
// 白黑严格镜像差值（初始对称局面评估仍为 0）。字段顺序与 ProfileHash 的规范化串即契约，
// 验收门 tournament/validate_eval_profile.mjs 用同一 djb2-32 算法独立重算比对。
type EvalProfileSpec struct {
	Name               string
	PawnShieldMissing  int // 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
	PawnShieldOpenFile int // 王自家线在王前方已无任何己方兵
	DoubledPawn        int // 每个叠兵（同线多出的每一个）
	IsolatedPawn       int // 每个孤兵（相邻线无己方兵）
	PassedPawnBase     int // 通路兵基础分
	PassedPawnPerRank  int // 通路兵每向升变推进一行的加成
	BishopPair         int // 双象
	MobilityWeight     int // 预留：机动性每步权重（试点关闭）
}

var EvalProfile = EvalProfileSpec{
	Name:               "balanced",
	PawnShieldMissing:  18,
	PawnShieldOpenFile: 12,
	DoubledPawn:        12,
	IsolatedPawn:       15,
	PassedPawnBase:     20,
	PassedPawnPerRank:  8,
	BishopPair:         30,
	MobilityWeight:     0,
}

// ProfileHash：profile 规范化串的 djb2-32，与 JS 侧 evalProfileHash 逐字节同算法。
func ProfileHash() string {
	s := fmt.Sprintf("%s|%d|%d|%d|%d|%d|%d|%d|%d",
		EvalProfile.Name, EvalProfile.PawnShieldMissing, EvalProfile.PawnShieldOpenFile,
		EvalProfile.DoubledPawn, EvalProfile.IsolatedPawn, EvalProfile.PassedPawnBase,
		EvalProfile.PassedPawnPerRank, EvalProfile.BishopPair, EvalProfile.MobilityWeight)
	h := uint32(5381)
	for i := 0; i < len(s); i++ {
		h = h*33 + uint32(s[i])
	}
	return fmt.Sprintf("%08x", h)
}

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
	// Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
	// 保持「初始局面评估 = 0」的对称性不变量。
	score += PawnStructureScore(state)
	score += KingSafetyScore(state)
	score += BishopPairScore(state)
	// 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
	if state.RepHistory != nil {
		if cnt, ok := state.RepHistory[state.PositionKeySimple()]; ok && cnt > 0 {
			score -= RepetitionPenalty * cnt
		}
	}
	return score
}

// ---------------------------- Tier 2-C 风格术语（白黑镜像差值） ----------------------------

// PawnStructureScore 兵形分（白方视角差值）：叠兵 / 孤兵 / 通路兵。
func PawnStructureScore(state *GameState) int {
	var wCnt, bCnt [8]int
	var wPawns, bPawns [][2]int
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			switch state.Board[r][c] {
			case 'P':
				wCnt[c]++
				wPawns = append(wPawns, [2]int{r, c})
			case 'p':
				bCnt[c]++
				bPawns = append(bPawns, [2]int{r, c})
			}
		}
	}
	W := EvalProfile
	score := 0
	for c := 0; c < 8; c++ {
		if wCnt[c] > 1 {
			score -= W.DoubledPawn * (wCnt[c] - 1)
		}
		if bCnt[c] > 1 {
			score += W.DoubledPawn * (bCnt[c] - 1)
		}
	}
	for _, pc := range wPawns {
		r, c := pc[0], pc[1]
		if (c == 0 || wCnt[c-1] == 0) && (c == 7 || wCnt[c+1] == 0) {
			score -= W.IsolatedPawn
		}
		passed := true
		for f := c - 1; f <= c+1 && passed; f++ {
			if f < 0 || f > 7 {
				continue
			}
			for rr := r - 1; rr >= 0; rr-- {
				if state.Board[rr][f] == 'p' {
					passed = false
					break
				}
			}
		}
		if passed {
			score += W.PassedPawnBase + W.PassedPawnPerRank*(6-r)
		}
	}
	for _, pc := range bPawns {
		r, c := pc[0], pc[1]
		if (c == 0 || bCnt[c-1] == 0) && (c == 7 || bCnt[c+1] == 0) {
			score += W.IsolatedPawn
		}
		passed := true
		for f := c - 1; f <= c+1 && passed; f++ {
			if f < 0 || f > 7 {
				continue
			}
			for rr := r + 1; rr <= 7; rr++ {
				if state.Board[rr][f] == 'P' {
					passed = false
					break
				}
			}
		}
		if passed {
			score -= W.PassedPawnBase + W.PassedPawnPerRank*(r-1)
		}
	}
	return score
}

// KingSafetyScore 王安全分（白方视角差值）：王在老家（白 r>=6 / 黑 r<=1）时检查兵盾与敞开线。
func KingSafetyScore(state *GameState) int {
	var wk, bk [2]int
	hasW, hasB := false, false
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			if state.Board[r][c] == 'K' {
				wk = [2]int{r, c}
				hasW = true
			} else if state.Board[r][c] == 'k' {
				bk = [2]int{r, c}
				hasB = true
			}
		}
	}
	if !hasW || !hasB {
		return 0
	}
	W := EvalProfile
	score := 0
	if wk[0] >= 6 {
		for c := wk[1] - 1; c <= wk[1]+1; c++ {
			if c < 0 || c > 7 {
				continue
			}
			if state.Board[wk[0]-1][c] != 'P' {
				score -= W.PawnShieldMissing
			}
		}
		shielded := false
		for r := wk[0] - 1; r >= 0; r-- {
			if state.Board[r][wk[1]] == 'P' {
				shielded = true
				break
			}
		}
		if !shielded {
			score -= W.PawnShieldOpenFile
		}
	}
	if bk[0] <= 1 {
		for c := bk[1] - 1; c <= bk[1]+1; c++ {
			if c < 0 || c > 7 {
				continue
			}
			if state.Board[bk[0]+1][c] != 'p' {
				score += W.PawnShieldMissing
			}
		}
		shielded := false
		for r := bk[0] + 1; r <= 7; r++ {
			if state.Board[r][bk[1]] == 'p' {
				shielded = true
				break
			}
		}
		if !shielded {
			score += W.PawnShieldOpenFile
		}
	}
	return score
}

// BishopPairScore 双象分（白方视角差值）。
func BishopPairScore(state *GameState) int {
	wb, bb := 0, 0
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			switch state.Board[r][c] {
			case 'B':
				wb++
			case 'b':
				bb++
			}
		}
	}
	score := 0
	if wb >= 2 {
		score += EvalProfile.BishopPair
	}
	if bb >= 2 {
		score -= EvalProfile.BishopPair
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
	// Tier 2-B：同 Negamax，途中按节点数检查硬阈值。
	if clockTick() {
		return alpha
	}
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

// ---------------------------- Tier 2-B 时间控制 ----------------------------
// 迭代加深 + 软/硬双阈值（与 JsChess/chessAI.js 的 SearchClock 同构）：
//   · 软阈值：开新一轮深度前检查（已用时间 >= 预算/2 就不再开新轮）；
//   · 硬阈值：搜索中每 nodesPerTimeCheck 个节点检查一次，超限置 aborted；
//     被中断的那一轮**结果作废**，只采用上一轮完整深度的结果，
//     从而保证返回的着法始终来自一次完整搜索。
// timeMs <= 0 时 clock == nil，完全不启用（走原固定深度路径，行为不变）。
const (
	nodesPerTimeCheck = 2048
	softNumerator     = 1
	softDenominator   = 2 // 软阈值 = 预算 × 1/2
)

type searchClock struct {
	limitMs int64
	startMs int64
	softMs  int64
	nodes   int64
	aborted bool
}

var clock *searchClock

// beginClock 启动（timeMs>0）或关闭（timeMs<=0）时间控制。
func beginClock(timeMs int64) {
	if timeMs <= 0 {
		clock = nil
		return
	}
	now := time.Now().UnixMilli()
	clock = &searchClock{limitMs: timeMs, startMs: now, softMs: now + timeMs*softNumerator/softDenominator}
}

// clockTick 每 nodesPerTimeCheck 个节点查一次硬阈值。
func clockTick() bool {
	if clock == nil {
		return false
	}
	clock.nodes++
	if clock.nodes%nodesPerTimeCheck == 0 && time.Now().UnixMilli()-clock.startMs >= clock.limitMs {
		clock.aborted = true
	}
	return clock.aborted
}

// clockOverSoft 软阈值：是否不该再开新一轮深度。
func clockOverSoft() bool {
	return clock != nil && time.Now().UnixMilli() >= clock.softMs
}

// ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
func Negamax(state *GameState, depth, alpha, beta, ply int) int {
	// Tier 2-B：硬阈值按节点数周期检查，超限立即中断（未完成的一轮会被丢弃）。
	if clockTick() {
		return alpha
	}
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

// searchRoot 根结点一轮搜索（给定深度），返回最佳走法。
func searchRoot(state *GameState, moves []Move, depth int) Move {
	OrderMoves(moves)
	bestScore := -Infinity
	alpha := -Infinity
	beta := Infinity
	bestMove := moves[0]
	for _, m := range moves {
		child := state.CloneLight()
		ApplyMove(&child, m, false)
		score := -Negamax(&child, depth-1, -beta, -alpha, 1)
		if clock != nil && clock.aborted {
			break // 硬阈值中断：本轮作废
		}
		if score > bestScore {
			bestScore = score
			bestMove = m
		}
		if score > alpha {
			alpha = score
		}
	}
	return bestMove
}

// FindBestMoveTimed 时间受控的最佳走法。
// timeMs > 0 时启用迭代加深（软/硬双阈值）；timeMs <= 0 时走原来的固定深度单次搜索，
// 结果与改造前完全一致。
func FindBestMoveTimed(state *GameState, depth, timeMs int) *Move {
	moves := GenerateAllLegalMoves(state)
	if len(moves) == 0 {
		return nil
	}
	if len(moves) == 1 {
		res := moves[0]
		return &res
	}
	cap := depth
	if cap <= 0 {
		cap = 3
	}

	if timeMs <= 0 || cap <= 1 {
		// 原路径：固定深度单次搜索（不含任何时钟开销）
		prev := clock
		clock = nil
		res := searchRoot(state, moves, cap)
		clock = prev
		return &res
	}

	// 迭代加深：d = 1..cap
	beginClock(int64(timeMs))
	bestMove := moves[0]
	completed := false
	for d := 1; d <= cap; d++ {
		if completed && clockOverSoft() {
			break
		}
		clock.aborted = false
		mv := searchRoot(state, append([]Move(nil), moves...), d)
		if clock.aborted && completed {
			break // 丢弃未完成的这一轮
		}
		bestMove = mv
		completed = true
	}
	clock = nil
	return &bestMove // 至少完成过 depth=1 的一轮，必为合法着法
}

// FindBestMove 无时间控制的固定深度搜索（保持原有调用约定）。
func FindBestMove(state *GameState, depth int) *Move {
	return FindBestMoveTimed(state, depth, 0)
}
