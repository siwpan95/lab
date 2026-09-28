# =============================================================================
# chess_ai.py — AI 对弈引擎（Python 3.13+）
# -----------------------------------------------------------------------------
# 与 E:\lab\CppChess\chess_ai.h/.cpp 完全对等的移植。
# 架构：
#   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
#   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
#   3. 终局评分：将死 ±900000（越快将死分越高）、逼和/子力不足 = 0
#
# 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
# 性能：搜索路径使用 GameState.clone_light() + apply_move(record_history=False)
# =============================================================================

from __future__ import annotations

from chess_core import GameState, Move, Rules, SpecialMove

# ---------------------------- 子力价值（厘兵单位） ----------------------------
# 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
PieceValue = (0, 100, 320, 330, 500, 900, 0)

# ---------------------------- 位置价值表 PST（白方视角） ----------------------------
# 顺序固定为 row0..row7，每列 a..h（逐字复制 port_spec）
PST_Pawn = (
    0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0,
)

PST_Knight = (
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
)

PST_Bishop = (
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
)

PST_Rook = (
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
)

PST_Queen = (
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
)

PST_King = (
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
)

# 按 PieceIndex 索引的 PST 表（索引 0 为占位全 0）
PST = (
    (0,) * 64,  # 0 空
    PST_Pawn,
    PST_Knight,
    PST_Bishop,
    PST_Rook,
    PST_Queen,
    PST_King,
)


class AIEngine:
    MateScore = 900000    # 将死基准分
    Infinity = 1000000    # 有界无穷大

    # ---------------------------- 内部工具 ----------------------------
    @staticmethod
    def piece_index(p: str) -> int:
        up = p.upper()
        if up == 'P':
            return 1
        if up == 'N':
            return 2
        if up == 'B':
            return 3
        if up == 'R':
            return 4
        if up == 'Q':
            return 5
        if up == 'K':
            return 6
        return 0

    @staticmethod
    def get_pst(piece_idx: int, pos: int) -> int:
        if 0 <= piece_idx <= 6:
            return PST[piece_idx][pos]
        return 0

    # ---------------------------- 局面评估（白方视角） ----------------------------
    @staticmethod
    def evaluate(state: GameState) -> int:
        score = 0
        b = state.board
        for r in range(8):
            for c in range(8):
                p = b[r][c]
                if p == '.':
                    continue
                idx = AIEngine.piece_index(p)
                pos = r * 8 + c
                if p.isupper():
                    score += PieceValue[idx] + AIEngine.get_pst(idx, pos)
                else:
                    score -= PieceValue[idx] + AIEngine.get_pst(idx, (7 - r) * 8 + c)
        return score

    @staticmethod
    def _evaluate_side(state: GameState) -> int:
        s = AIEngine.evaluate(state)
        return s if state.whiteToMove else -s

    # ---------------------------- 走法排序（MVV-LVA） ----------------------------
    @staticmethod
    def move_order_score(m: Move) -> int:
        if m.captured == '.':
            return 0
        victim = PieceValue[AIEngine.piece_index(m.captured)]
        attacker = PieceValue[AIEngine.piece_index(m.piece)]
        return victim * 10 - attacker

    @staticmethod
    def order_moves(moves: list[Move]) -> None:
        moves.sort(key=AIEngine.move_order_score, reverse=True)

    # ---------------------------- 静态搜索（quiescence） ----------------------------
    @staticmethod
    def quiescence(state: GameState, alpha: int, beta: int, qdepth: int) -> int:
        stand = AIEngine._evaluate_side(state)
        if stand >= beta:
            return beta
        if stand > alpha:
            alpha = stand
        if qdepth >= 4:
            return alpha

        captures: list[Move] = []
        for m in Rules.generate_all_legal_moves(state):
            if m.captured != '.':
                captures.append(m)
        AIEngine.order_moves(captures)

        for m in captures:
            child = state.clone_light()
            Rules.apply_move(child, m, False)
            score = -AIEngine.quiescence(child, -beta, -alpha, qdepth + 1)
            if score >= beta:
                return beta
            if score > alpha:
                alpha = score
        return alpha

    # ---------------------------- 主搜索：negamax + alpha-beta ----------------------------
    @staticmethod
    def negamax(state: GameState, depth: int, alpha: int, beta: int, ply: int) -> int:
        moves = Rules.generate_all_legal_moves(state)

        if not moves:
            if Rules.is_in_check(state, state.whiteToMove):
                return -AIEngine.MateScore + ply  # 被将死：离根越近越差
            return 0  # 逼和

        if depth <= 0:
            return AIEngine.quiescence(state, alpha, beta, 0)

        AIEngine.order_moves(moves)

        best = -AIEngine.Infinity
        for m in moves:
            child = state.clone_light()
            Rules.apply_move(child, m, False)
            score = -AIEngine.negamax(child, depth - 1, -beta, -alpha, ply + 1)
            if score > best:
                best = score
            if best > alpha:
                alpha = best
            if alpha >= beta:
                break  # β 剪枝
        return best

    # ---------------------------- 对外接口：求最佳走法 ----------------------------
    @staticmethod
    def find_best_move(state: GameState, depth: int) -> Move | None:
        moves = Rules.generate_all_legal_moves(state)
        if not moves:
            return None
        if len(moves) == 1:
            return moves[0]

        AIEngine.order_moves(moves)

        best_move = moves[0]
        best_score = -AIEngine.Infinity
        alpha = -AIEngine.Infinity
        beta = AIEngine.Infinity

        for m in moves:
            child = state.clone_light()
            Rules.apply_move(child, m, False)
            score = -AIEngine.negamax(child, depth - 1, -beta, -alpha, 1)
            if score > best_score:
                best_score = score
                best_move = m
            if score > alpha:
                alpha = score
        return best_move
