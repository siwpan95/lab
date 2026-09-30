# =============================================================================
# chess_ai.py — AI 对弈引擎（Python 3.13+）
# -----------------------------------------------------------------------------
# 与 CppChess\chess_ai.h/.cpp 完全对等的移植。
# 架构：
#   1. 评估层：子力价值 + 棋子-格子位置价值表 PST
#   2. 搜索层：negamax + alpha-beta 剪枝 + 走法排序（MVV-LVA）+ 静态搜索 quiescence
#   3. 终局评分：将死 ±900000（越快将死分越高）、逼和/子力不足 = 0
#
# 难度分级：搜索深度 1（新手）/ 2（中级）/ 3（高级）
# 性能：搜索路径使用 GameState.clone_light() + apply_move(record_history=False)
# =============================================================================

from __future__ import annotations

import time

from chess_core import GameState, Move, Rules, SpecialMove

# ---------------------------- 子力价值（厘兵单位） ----------------------------
# 索引：0=空 1=兵 2=马 3=象 4=车 5=后 6=王
PieceValue = (0, 100, 320, 330, 500, 900, 0)

# 重复惩罚：叶局面的 engine.mjs 兼容键出现在 rep_history（本局此前见过）中时，按出现次数
# 扣分（白方视角）。引导搜索远离重复局面，减少三重复和棋。约半兵，足以影响平手选择而不弃子。
REPETITION_PENALTY = 60

# ---------------------------- 评估风格档（Tier 2-C 批1 试点） ----------------------------
# 与 JsChess/chessAI.js 的 EVAL_PROFILE 同构：每引擎一份独立 profile，术语全部是
# 白黑严格镜像差值（初始对称局面评估仍为 0）。字段顺序与 eval_profile_hash 的规范化串即契约，
# 验收门 tournament/validate_eval_profile.mjs 用同一 djb2-32 算法独立重算比对。
# mobility_weight 为预留字段（0 = 关闭），试点只启用兵盾/兵形/双象三组术语。
EVAL_PROFILE = {
    "name": "gambit",
    "pawnShieldMissing": 5,   # 王处于老家（白 r>=6 / 黑 r<=1）时，王前 3 格每缺一兵
    "pawnShieldOpenFile": 3,  # 王自家线在王前方已无任何己方兵
    "doubledPawn": 4,         # 每个叠兵（同线多出的每一个）
    "isolatedPawn": 5,        # 每个孤兵（相邻线无己方兵）
    "passedPawnBase": 10,     # 通路兵基础分
    "passedPawnPerRank": 3,   # 通路兵每向升变推进一行的加成
    "bishopPair": 8,          # 双象
    "mobilityWeight": 0,      # 预留：机动性每步权重（试点关闭）
}


def eval_profile_hash(p: dict) -> str:
    # profile 规范化串 + djb2-32 哈希，与 JS 侧 evalProfileHash 逐字节同算法。
    s = "|".join(str(p[k]) for k in (
        "name", "pawnShieldMissing", "pawnShieldOpenFile", "doubledPawn",
        "isolatedPawn", "passedPawnBase", "passedPawnPerRank",
        "bishopPair", "mobilityWeight"))
    h = 5381
    for ch in s:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return "%08x" % h

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


# ---------------------------- Tier 2-B 时间控制 ----------------------------
# 迭代加深 + 软/硬双阈值（与 Go chess_ai.go 的 searchClock / JsChess/chessAI.js 的
# SearchClock 同构）：
#   · 软阈值：开新一轮深度前检查（已用时间 >= 预算×SOFT_FRACTION 就不再开新轮），
#     避免"明知做不完还开局"；
#   · 硬阈值：搜索过程中按节点数周期检查（每 NODES_PER_TIME_CHECK 个节点），
#     超限立即中断；被中断的那一轮**结果作废**，只采用上一轮完整深度的结果。
# 这样保证返回的着法始终来自一次完整搜索，绝不会因为中断返回半成品。
# timeMs <= 0（或缺省请求）时时钟为 None，完全不启用，走原来的固定深度搜索路径。
# 注：Go/JS/C++ 等编译型引擎用 2048；Python 是 10 引擎中最慢的（节点速率约
# 2–3k/s），2048 个节点要跑 ~700ms，采样太稀会让实际耗时明显过冲预算
# （实测 700ms 预算跑到 1141ms）。这里把采样粒度调细到 256（约 100ms 一次），
# 语义与其余引擎完全一致，只是检查更频繁。
NODES_PER_TIME_CHECK = 256
SOFT_FRACTION = 0.5


class SearchClock:
    """一次 find_best_move_timed 调用期间的搜索时钟。"""
    __slots__ = ("limit_ms", "start_ms", "soft_ms", "nodes", "aborted")

    def __init__(self, limit_ms: float) -> None:
        self.limit_ms = float(limit_ms)
        self.start_ms = time.perf_counter() * 1000.0
        self.soft_ms = self.start_ms + self.limit_ms * SOFT_FRACTION
        self.nodes = 0
        self.aborted = False

    def _now_ms(self) -> float:
        return time.perf_counter() * 1000.0

    # 软阈值：是否不该再开新一轮深度
    def over_soft(self) -> bool:
        return self._now_ms() >= self.soft_ms

    # 硬阈值：每 NODES_PER_TIME_CHECK 个节点查一次；超限置 aborted
    def tick(self) -> bool:
        self.nodes += 1
        if self.nodes & (NODES_PER_TIME_CHECK - 1) == 0:
            if self._now_ms() - self.start_ms >= self.limit_ms:
                self.aborted = True
        return self.aborted


# 当前搜索的时钟（无时间控制时为 None）
_search_clock: SearchClock | None = None


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
        # Tier 2-C 风格术语：白黑镜像差值（白方项加、黑方项减），
        # 保持「初始局面评估 = 0」的对称性不变量。
        score += AIEngine.positional_score(state)
        # 重复惩罚：叶局面在 rep_history 中出现过 → 引导搜索规避重复、减少三重复和棋。
        if state.rep_history:
            key = state.position_key_simple()
            cnt = state.rep_history.get(key)
            if cnt:
                score -= REPETITION_PENALTY * cnt
        return score

    @staticmethod
    def _evaluate_side(state: GameState) -> int:
        s = AIEngine.evaluate(state)
        return s if state.whiteToMove else -s

    # ---------------------------- Tier 2-C 风格术语（白黑镜像差值） ----------------------------
    # 注：为满足深度 3 搜索 < 2 秒的性能门（python 是 10 引擎中最慢的），把兵形/王安全/
    # 双象三项合并为**单遍棋盘扫描**：一次收集全部特征再计分，判定语义与 JS/Go 参考
    # 实现逐行同构（叠兵/孤兵/通路兵/兵盾/敞开线/双象，白加黑减）。
    @staticmethod
    def positional_score(state: GameState) -> int:
        W = EVAL_PROFILE
        w_cnt = [0] * 8
        b_cnt = [0] * 8
        # 每 file 预计算：黑兵最小行 / 白兵最大行（无兵时分别取 8 / -1）。
        # 白兵 (r,c) 通路 ⇔ 各有效邻 file 的 b_first[f] >= r；黑兵 ⇔ w_last[f] <= r。
        b_first = [8] * 8
        w_last = [-1] * 8
        w_pawns: list[tuple[int, int]] = []
        b_pawns: list[tuple[int, int]] = []
        wk = bk = None
        wb = bb = 0
        for r, row in enumerate(state.board):
            for c, p in enumerate(row):
                if p == 'P':
                    w_cnt[c] += 1
                    w_pawns.append((r, c))
                    if r > w_last[c]:
                        w_last[c] = r
                elif p == 'p':
                    b_cnt[c] += 1
                    b_pawns.append((r, c))
                    if r < b_first[c]:
                        b_first[c] = r
                elif p == 'K':
                    wk = (r, c)
                elif p == 'k':
                    bk = (r, c)
                elif p == 'B':
                    wb += 1
                elif p == 'b':
                    bb += 1
        score = 0
        # 叠兵
        for c in range(8):
            if w_cnt[c] > 1:
                score -= W["doubledPawn"] * (w_cnt[c] - 1)
            if b_cnt[c] > 1:
                score += W["doubledPawn"] * (b_cnt[c] - 1)
        # 孤兵 + 通路兵
        passed_base, passed_rank = W["passedPawnBase"], W["passedPawnPerRank"]
        for r, c in w_pawns:
            if (c == 0 or w_cnt[c - 1] == 0) and (c == 7 or w_cnt[c + 1] == 0):
                score -= W["isolatedPawn"]
            if (c == 0 or b_first[c - 1] >= r) and b_first[c] >= r and (c == 7 or b_first[c + 1] >= r):
                score += passed_base + passed_rank * (6 - r)
        for r, c in b_pawns:
            if (c == 0 or b_cnt[c - 1] == 0) and (c == 7 or b_cnt[c + 1] == 0):
                score += W["isolatedPawn"]
            if (c == 0 or w_last[c - 1] <= r) and w_last[c] <= r and (c == 7 or w_last[c + 1] <= r):
                score -= passed_base + passed_rank * (r - 1)
        # 王安全（兵盾 + 敞开线），仅王在老家时生效
        if wk is not None and wk[0] >= 6:
            r0, c0 = wk
            for c in range(max(0, c0 - 1), min(7, c0 + 1) + 1):
                if state.board[r0 - 1][c] != 'P':
                    score -= W["pawnShieldMissing"]
            shielded = False
            for r in range(r0 - 1, -1, -1):
                if state.board[r][c0] == 'P':
                    shielded = True
                    break
            if not shielded:
                score -= W["pawnShieldOpenFile"]
        if bk is not None and bk[0] <= 1:
            r0, c0 = bk
            for c in range(max(0, c0 - 1), min(7, c0 + 1) + 1):
                if state.board[r0 + 1][c] != 'p':
                    score += W["pawnShieldMissing"]
            shielded = False
            for r in range(r0 + 1, 8):
                if state.board[r][c0] == 'p':
                    shielded = True
                    break
            if not shielded:
                score += W["pawnShieldOpenFile"]
        # 双象
        if wb >= 2:
            score += W["bishopPair"]
        if bb >= 2:
            score -= W["bishopPair"]
        return score

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
        # Tier 2-B：同 negamax，途中按节点数检查硬阈值。
        if _search_clock is not None and _search_clock.tick():
            return alpha
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
        # Tier 2-B：硬阈值按节点数周期检查，超限立即中断（未完成的一轮会被丢弃）。
        if _search_clock is not None and _search_clock.tick():
            return alpha
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
    # 根结点一轮搜索（给定深度），返回最佳走法。硬阈值中断时提前 break，
    # 由调用方丢弃本轮结果。
    @staticmethod
    def _search_root(state: GameState, moves: list[Move], depth: int) -> Move:
        AIEngine.order_moves(moves)

        best_move = moves[0]
        best_score = -AIEngine.Infinity
        alpha = -AIEngine.Infinity
        beta = AIEngine.Infinity

        for m in moves:
            child = state.clone_light()
            Rules.apply_move(child, m, False)
            score = -AIEngine.negamax(child, depth - 1, -beta, -alpha, 1)
            if _search_clock is not None and _search_clock.aborted:
                break  # 硬阈值中断：本轮作废
            if score > best_score:
                best_score = score
                best_move = m
            if score > alpha:
                alpha = score
        return best_move

    # 时间受控的最佳走法。
    # time_ms > 0 时启用迭代加深（软/硬双阈值）；time_ms <= 0 时走原来的固定深度
    # 单次搜索，**严格沿用调用方 depth**（不套 cap），结果与改造前逐字节一致。
    @staticmethod
    def find_best_move_timed(state: GameState, depth: int, time_ms: float = 0) -> Move | None:
        global _search_clock
        moves = Rules.generate_all_legal_moves(state)
        if not moves:
            return None
        if len(moves) == 1:
            return moves[0]

        try:
            budget = float(time_ms)
        except (TypeError, ValueError):
            budget = 0.0

        if not (budget > 0) or depth <= 1:
            # 原路径：固定深度单次搜索（不含任何时钟开销）
            prev = _search_clock
            _search_clock = None
            try:
                return AIEngine._search_root(state, moves, depth)
            finally:
                _search_clock = prev

        # 迭代加深：d = 1..cap，软阈值管"是否开新一轮"，硬阈值管"中断当前轮"。
        cap = depth if depth > 0 else 3
        _search_clock = SearchClock(budget)
        best_move = moves[0]
        completed = False  # 是否已至少完成一轮（中断时回退到它）
        try:
            for d in range(1, cap + 1):
                if completed and _search_clock.over_soft():
                    break
                _search_clock.aborted = False
                mv = AIEngine._search_root(state, list(moves), d)
                if _search_clock.aborted and completed:
                    break  # 丢弃未完成的这一轮
                best_move = mv
                completed = True
        finally:
            _search_clock = None
        return best_move  # 至少完成过 depth=1 的一轮，必为合法着法

    # 无时间控制的固定深度搜索（保持原有调用约定）。
    @staticmethod
    def find_best_move(state: GameState, depth: int) -> Move | None:
        return AIEngine.find_best_move_timed(state, depth, 0)
