# =============================================================================
# tests.py — 核心规则自测（Python 3.13+）
# -----------------------------------------------------------------------------
# 与 E:\lab\CppChess\tests.cpp 完全对等的移植（24 组 / 97 项断言）。
# 覆盖：初始走法数 / 过路兵 / 王车易位 / 升变 / 将死（学者杀、愚兄杀）/
#       逼和 / 子力不足 / 50 步计数 / IsAttacked 基础语义 / 钉死 / 逃将 /
#       EP 揭开将军 / 子力不足扩展 / 深度3计时 / 角格车被吃撤销易位权 /
#       退化局面 / 升变 SAN
#
# 运行：python tests.py  （或 main.py test）
# 返回失败数（0 = 全绿）。
# =============================================================================

from __future__ import annotations

import time

from chess_core import GameState, Move, Rules, SpecialMove
from chess_ai import AIEngine


_pass = 0
_fail = 0


def check(name: str, cond: bool) -> None:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"[PASS] {name}")
    else:
        _fail += 1
        print(f"[FAIL] {name}")


# 在 (r,c) 的合法走法中找目标格为 (tr,tc) 的走法
def find_move(state: GameState, r: int, c: int, tr: int, tc: int) -> Move:
    for m in Rules.generate_legal_moves(state, r, c):
        if m.toRow == tr and m.toCol == tc:
            return m
    raise RuntimeError("move not found")


# 走一步并返回新状态（深拷贝 + 应用）
def play(state: GameState, r: int, c: int, tr: int, tc: int) -> GameState:
    m = find_move(state, r, c, tr, tc)
    s = state.clone()
    Rules.apply_move(s, m)
    return s


# 清空棋盘上所有棋子（测试用）
def empty_board(s: GameState) -> None:
    for r in range(8):
        for c in range(8):
            s.board[r][c] = '.'
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = False
    s.enPassantRow = s.enPassantCol = -1
    s.halfmoveClock = 0
    s.fullmoveNumber = 1
    s.history.clear()
    s.positionKeys.clear()
    s.positionKeys.append(s.get_position_key())


# 由 FEN 式 rank 串构建局面（rank 8 在前，直接赋值各字段）
def setup_position(ranks: list[str], castling: str) -> GameState:
    s = GameState()
    s.board = [['.' for _ in range(8)] for _ in range(8)]
    for r in range(8):
        c = 0
        for ch in ranks[r]:
            if ch.isdigit():
                c += int(ch)
            else:
                s.board[r][c] = ch
                c += 1
    s.whiteToMove = True
    s.canCastleWK = 'K' in castling
    s.canCastleWQ = 'Q' in castling
    s.canCastleBK = 'k' in castling
    s.canCastleBQ = 'q' in castling
    s.enPassantRow = -1
    s.enPassantCol = -1
    s.halfmoveClock = 0
    s.fullmoveNumber = 1
    s.history.clear()
    s.positionKeys.clear()
    s.positionKeys.append(s.get_position_key())
    return s


# perft：走法生成节点计数（与既有测试同款 clone/apply_move 形式）
def perft(state: GameState, depth: int) -> int:
    if depth == 0:
        return 1
    moves = Rules.generate_all_legal_moves(state)
    if depth == 1:
        return len(moves)
    count = 0
    for m in moves:
        child = state.clone()
        Rules.apply_move(child, m)
        count += perft(child, depth - 1)
    return count


# ---------- 1. 初始局面 ----------
def test_initial_position() -> None:
    s = GameState()
    check("初始局面白方合法走法数 = 20", len(Rules.generate_all_legal_moves(s)) == 20)
    check("初始局面 b1 马走法数 = 2", len(Rules.generate_legal_moves(s, 7, 1)) == 2)
    check("初始局面 g1 马走法数 = 2", len(Rules.generate_legal_moves(s, 7, 6)) == 2)
    check("初始局面 e2 兵走法数 = 2", len(Rules.generate_legal_moves(s, 6, 4)) == 2)
    check("初始局面 d1 后走法数 = 0", len(Rules.generate_legal_moves(s, 7, 3)) == 0)
    check("初始局面白王不被将军", not Rules.is_in_check(s, True))
    check("初始局面黑王不被将军", not Rules.is_in_check(s, False))
    check("初始局面非将死", not Rules.is_checkmate(s))

    b = GameState()
    b.whiteToMove = False
    check("初始局面黑方合法走法数 = 20", len(Rules.generate_all_legal_moves(b)) == 20)


# ---------- 2. IsAttacked 基础语义 ----------
def test_is_attacked_basics() -> None:
    s = GameState()
    empty_board(s)
    s.board[4][4] = 'P'   # 白兵 e4
    s.board[3][4] = 'p'   # 黑兵 e5
    s.board[7][4] = 'K'   # 白王 e1
    s.board[0][4] = 'k'   # 黑王 e8

    check("白兵 e4 攻击 d5", Rules.is_attacked(s.board, 3, 3, True))
    check("白兵 e4 攻击 f5", Rules.is_attacked(s.board, 3, 5, True))
    check("白兵 e4 不攻击 e5（兵不直吃）", not Rules.is_attacked(s.board, 3, 4, True))
    check("黑兵 e5 攻击 d4", Rules.is_attacked(s.board, 4, 3, False))
    check("黑兵 e5 攻击 f4", Rules.is_attacked(s.board, 4, 5, False))
    check("a1 格不被任何方攻击",
          not Rules.is_attacked(s.board, 7, 0, True) and not Rules.is_attacked(s.board, 7, 0, False))
    check("白王 e1 攻击 e2", Rules.is_attacked(s.board, 6, 4, True))


# ---------- 3. 双进兵与吃过路兵 ----------
def test_pawn_double_and_en_passant() -> None:
    s = GameState()
    s = play(s, 6, 4, 4, 4)  # 1. e2-e4
    check("e4 双进兵设置过路兵格 (5,4)", s.enPassantRow == 5 and s.enPassantCol == 4)
    check("双进兵后半步计数 = 0", s.halfmoveClock == 0)
    check("e4 后轮黑方", not s.whiteToMove)

    t = GameState()
    empty_board(t)
    t.board[3][4] = 'P'   # 白兵 e5
    t.board[1][3] = 'p'   # 黑兵 d7（将双走进 d5）
    t.whiteToMove = False
    t = play(t, 1, 3, 3, 3)  # 黑 d7-d5 → ep 目标 d6 (2,3)
    check("黑 d5 双进后轮白方", t.whiteToMove)

    pawn_moves = Rules.generate_legal_moves(t, 3, 4)
    has_ep = any(m.special == SpecialMove.EnPassant for m in pawn_moves)
    check("白 e5 兵存在吃过路兵走法", has_ep)

    ep_move = next(m for m in pawn_moves if m.special == SpecialMove.EnPassant)
    after = t.clone()
    Rules.apply_move(after, ep_move)
    check("过路兵吃后白兵位于 d6", after.board[2][3] == 'P')
    check("过路兵吃后黑 d5 兵被移除", after.board[3][3] == '.')
    check("过路兵吃后过路兵格已清空", after.enPassantRow == -1)


# ---------- 4. 王车易位 ----------
def test_castling() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][4] = 'K'; s.board[7][7] = 'R'; s.board[7][0] = 'R'
    s.board[0][4] = 'k'
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = True

    king_moves = Rules.generate_legal_moves(s, 7, 4)
    castle_k = any(m.special == SpecialMove.CastleKingside for m in king_moves)
    castle_q = any(m.special == SpecialMove.CastleQueenside for m in king_moves)
    check("白王可短易位", castle_k)
    check("白王可长易位", castle_q)

    mv = next(m for m in Rules.generate_legal_moves(s, 7, 4)
              if m.special == SpecialMove.CastleKingside)
    after = s.clone()
    Rules.apply_move(after, mv)
    check("短易位后白王位于 g1", after.board[7][6] == 'K')
    check("短易位后白车位于 f1", after.board[7][5] == 'R')
    check("短易位后 h1 为空", after.board[7][7] == '.')
    check("短易位后白方失去全部易位权", not after.canCastleWK and not after.canCastleWQ)

    blocked = s.clone()
    blocked.board[3][3] = 'r'   # 黑车 d5，攻击 d1
    km = Rules.generate_legal_moves(blocked, 7, 4)
    castle_q_blocked = any(m.special == SpecialMove.CastleQueenside for m in km)
    check("路径 d1 被攻击时长易位被禁止", not castle_q_blocked)

    in_check = s.clone()
    in_check.board[3][4] = 'r'   # 黑车 e5 攻击 e1
    km = Rules.generate_legal_moves(in_check, 7, 4)
    any_castle = any(m.special in (SpecialMove.CastleKingside, SpecialMove.CastleQueenside) for m in km)
    check("王被将军时禁止易位", not any_castle)


# ---------- 5. 兵升变 ----------
def test_promotion() -> None:
    s = GameState()
    empty_board(s)
    s.board[1][4] = 'P'; s.board[7][4] = 'K'; s.board[0][7] = 'k'

    moves = Rules.generate_legal_moves(s, 1, 4)
    promo_count = sum(1 for m in moves if m.special == SpecialMove.Promotion)
    check("e7 兵生成 4 种升变走法（Q/R/B/N）", promo_count == 4)

    mv = next(m for m in Rules.generate_legal_moves(s, 1, 4)
              if m.special == SpecialMove.Promotion and m.promotion == 'Q')
    after = s.clone()
    Rules.apply_move(after, mv)
    check("升变后 e8 为白后", after.board[0][4] == 'Q')
    check("升变后 e7 为空", after.board[1][4] == '.')


# ---------- 6. 学者将杀 ----------
def test_scholar_mate() -> None:
    s = GameState()
    s = play(s, 6, 4, 4, 4)   # 1. e4
    s = play(s, 1, 4, 3, 4)   # 1... e5
    s = play(s, 7, 5, 4, 2)   # 2. Bf1-c4
    s = play(s, 0, 1, 2, 2)   # 2... Nb8-c6
    s = play(s, 7, 3, 3, 7)   # 3. Qd1-h5
    s = play(s, 0, 6, 2, 5)   # 3... Ng8-f6
    s = play(s, 3, 7, 1, 5)   # 4. Qh5xf7#

    check("学者将杀：黑方被将军", Rules.is_in_check(s, False))
    check("学者将杀：IsCheckmate = True", Rules.is_checkmate(s))
    check("学者将杀：非逼和", not Rules.is_stalemate(s))
    check("学者将杀后轮黑方", not s.whiteToMove)


# ---------- 7. 愚兄杀 ----------
def test_fool_mate() -> None:
    s = GameState()
    s = play(s, 6, 5, 5, 5)   # 1. f3
    s = play(s, 1, 4, 3, 4)   # 1... e5
    s = play(s, 6, 6, 4, 6)   # 2. g4
    s = play(s, 0, 3, 4, 7)   # 2... Qd8-h4#

    check("愚兄杀：白方被将军", Rules.is_in_check(s, True))
    check("愚兄杀：IsCheckmate = True", Rules.is_checkmate(s))


# ---------- 8. 逼和 ----------
def test_stalemate() -> None:
    s = GameState()
    empty_board(s)
    s.board[0][7] = 'k'; s.board[1][5] = 'Q'; s.board[2][6] = 'K'
    s.whiteToMove = False

    check("逼和局面：黑方不被将军", not Rules.is_in_check(s, False))
    check("逼和局面：黑方合法走法数 = 0", len(Rules.generate_all_legal_moves(s)) == 0)
    check("逼和局面：IsStalemate = True", Rules.is_stalemate(s))
    check("逼和局面：非将死", not Rules.is_checkmate(s))


# ---------- 9. 子力不足 ----------
def test_insufficient_material() -> None:
    kk = GameState()
    empty_board(kk)
    kk.board[7][4] = 'K'; kk.board[0][4] = 'k'
    check("仅剩双王 = 子力不足", Rules.is_insufficient_material(kk))

    kk.board[4][4] = 'N'
    check("王+单马 vs 王 = 子力不足", Rules.is_insufficient_material(kk))

    kk.board[4][4] = 'b'
    check("王+单象 vs 王 = 子力不足", Rules.is_insufficient_material(kk))

    kk.board[4][4] = 'P'
    check("王+兵 vs 王 ≠ 子力不足", not Rules.is_insufficient_material(kk))

    kk.board[4][4] = 'R'
    check("王+车 vs 王 ≠ 子力不足", not Rules.is_insufficient_material(kk))

    full = GameState()
    check("初始局面 ≠ 子力不足", not Rules.is_insufficient_material(full))


# ---------- 10. 50 步规则计数 ----------
def test_fifty_move_counter() -> None:
    s = GameState()
    s = play(s, 7, 6, 5, 5)   # 1. Ng1-f3
    check("马走一步后半步计数 = 1", s.halfmoveClock == 1)
    s = play(s, 0, 6, 2, 5)   # 1... Ng8-f6
    check("两步非兵非吃后半步计数 = 2", s.halfmoveClock == 2)
    s = play(s, 5, 5, 7, 6)   # 2. Nf3-g1
    check("三步后半步计数 = 3", s.halfmoveClock == 3)
    s = play(s, 2, 5, 0, 6)   # 2... Nf6-g8
    check("四步后半步计数 = 4", s.halfmoveClock == 4)
    s = play(s, 6, 4, 4, 4)   # 3. e4（动兵清零）
    check("动兵后半步计数清零", s.halfmoveClock == 0)
    check("未达 100 半步不判 50 步和棋", not Rules.is_fifty_move_draw(s))

    forced = GameState()
    forced.halfmoveClock = 100
    check("100 半步判 50 步和棋", Rules.is_fifty_move_draw(forced))


# ---------- 11. 三次重复局面判和 ----------
def test_threefold_repetition() -> None:
    s = GameState()
    s = play(s, 7, 6, 5, 5); s = play(s, 0, 6, 2, 5)
    s = play(s, 5, 5, 7, 6); s = play(s, 2, 5, 0, 6)
    check("4 步往返后局面重复第 2 次（不判和）", not Rules.is_threefold_repetition(s))

    s = play(s, 7, 6, 5, 5); s = play(s, 0, 6, 2, 5)
    s = play(s, 5, 5, 7, 6); s = play(s, 2, 5, 0, 6)
    check("8 步往返后局面重复第 3 次（判和）", Rules.is_threefold_repetition(s))

    s = play(s, 6, 4, 4, 4)
    check("走出新局面后不再判和", not Rules.is_threefold_repetition(s))


# ---------- 12. 评估函数 ----------
def test_evaluation() -> None:
    s = GameState()
    check("初始局面评估 = 0（对称）", AIEngine.evaluate(s) == 0)
    s.board[4][4] = 'P'
    score1 = AIEngine.evaluate(s)
    check("白方多一兵 → 评估为正", score1 > 0)
    s.board[3][3] = 'n'
    score2 = AIEngine.evaluate(s)
    check("黑方多一马压过白方一兵 → 评估为负", score2 < 0)


# ---------- 13. Negamax 终局评分 ----------
def test_negamax_terminal_scores() -> None:
    s = GameState()
    s = play(s, 6, 4, 4, 4); s = play(s, 1, 4, 3, 4)
    s = play(s, 7, 5, 4, 2); s = play(s, 0, 1, 2, 2)
    s = play(s, 7, 3, 3, 7); s = play(s, 0, 6, 2, 5)
    s = play(s, 3, 7, 1, 5)   # 4. Qxf7#
    mate_score = AIEngine.negamax(s, 2, -AIEngine.Infinity, AIEngine.Infinity, 0)
    check("将死局面 negamax 返回大负数", mate_score <= -9000)

    st = GameState()
    empty_board(st)
    st.board[0][7] = 'k'; st.board[1][5] = 'Q'; st.board[2][6] = 'K'
    st.whiteToMove = False
    st.positionKeys.clear(); st.positionKeys.append(st.get_position_key())
    stale_score = AIEngine.negamax(st, 2, -AIEngine.Infinity, AIEngine.Infinity, 0)
    check("逼和局面 negamax 返回 0", stale_score == 0)


# ---------- 14. AI 一步杀 ----------
def test_ai_finds_mate() -> None:
    s = GameState()
    empty_board(s)
    s.board[2][1] = 'K'; s.board[7][7] = 'Q'; s.board[0][0] = 'k'
    s.whiteToMove = True
    s.positionKeys.clear(); s.positionKeys.append(s.get_position_key())

    best = AIEngine.find_best_move(s, 2)
    after = s.clone()
    Rules.apply_move(after, best)
    check("AI 深度 2 找到一步杀（Qh8#）", Rules.is_checkmate(after))


# ---------- 15. AI 白吃无保护后 ----------
def test_ai_captures_free_queen() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][3] = 'Q'; s.board[7][4] = 'K'; s.board[0][3] = 'q'; s.board[0][7] = 'k'
    s.whiteToMove = True
    s.positionKeys.clear(); s.positionKeys.append(s.get_position_key())

    best = AIEngine.find_best_move(s, 2)
    check("AI 深度 2 捕获无保护黑后",
          best is not None and best.toRow == 0 and best.toCol == 3 and best.captured == 'q')


# ---------- 16. AI 开局合理性 ----------
def test_ai_choose_reasonable_opening() -> None:
    s = GameState()
    t0 = time.perf_counter()
    best = AIEngine.find_best_move(s, 2)
    t1 = time.perf_counter()
    is_legal = False
    if best is not None:
        for m in Rules.generate_all_legal_moves(s):
            if (m.fromRow == best.fromRow and m.fromCol == best.fromCol and
                    m.toRow == best.toRow and m.toCol == best.toCol):
                is_legal = True
    check("初始局面 AI 返回合法走法", is_legal)
    ms = (t1 - t0) * 1000.0
    check("AI 深度 2 初始局面搜索 < 5 秒", ms < 5000)


# ---------- 17. 被钉死棋子限制 ----------
def test_pinned_piece() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][3] = 'K'; s.board[6][3] = 'B'; s.board[0][3] = 'r'; s.board[0][4] = 'k'
    check("钉死前象存在伪合法走法", len(Rules.generate_pseudo_moves(s, 6, 3)) > 0)
    check("被钉死象无合法走法", len(Rules.generate_legal_moves(s, 6, 3)) == 0)
    check("钉死局面白王未被将军", not Rules.is_in_check(s, True))


# ---------- 18. 被将军时合法走法枚举 ----------
def test_check_evasion() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][4] = 'K'; s.board[0][4] = 'r'; s.board[0][0] = 'k'
    check("逃将局面白王被将军", Rules.is_in_check(s, True))
    legal = Rules.generate_all_legal_moves(s)
    check("被将军时合法走法均为逃着（>0）", len(legal) > 0)
    all_resolve = True
    for m in legal:
        after = s.clone()
        Rules.apply_move(after, m)
        if Rules.is_in_check(after, True):
            all_resolve = False
    check("每个合法走法均解除将军", all_resolve)


# ---------- 19. 过路兵吃子揭开己方王 ----------
def test_en_passant_reveal_check() -> None:
    s = GameState()
    empty_board(s)
    s.board[3][0] = 'K'; s.board[3][7] = 'r'; s.board[3][3] = 'P'; s.board[3][4] = 'p'
    s.whiteToMove = True
    s.enPassantRow = 2; s.enPassantCol = 4
    s.positionKeys.clear()
    check("EP 揭开将军：当前白王未被将军", not Rules.is_in_check(s, True))
    legal = Rules.generate_legal_moves(s, 3, 3)
    has_ep = any(m.special == SpecialMove.EnPassant for m in legal)
    check("EP 吃子会揭开己方王 → 不出现在合法走法中", not has_ep)


# ---------- 20. 子力不足扩展 ----------
def test_insufficient_material_extended() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][4] = 'K'; s.board[0][4] = 'k'
    check("KK = 子力不足", Rules.is_insufficient_material(s))
    s.board[7][1] = 'N'
    check("KN vs K = 子力不足", Rules.is_insufficient_material(s))
    s.board[7][2] = 'N'
    check("KNN vs K = 子力不足", Rules.is_insufficient_material(s))

    kb = GameState()
    empty_board(kb)
    kb.board[7][4] = 'K'; kb.board[0][4] = 'k'
    kb.board[7][2] = 'B'; kb.board[0][3] = 'b'
    check("KB vs KB = 子力不足", Rules.is_insufficient_material(kb))

    kbb = GameState()
    empty_board(kbb)
    kbb.board[7][4] = 'K'; kbb.board[0][4] = 'k'
    kbb.board[7][2] = 'B'; kbb.board[7][5] = 'B'
    check("KBB 异色格双象可杀 ≠ 子力不足", not Rules.is_insufficient_material(kbb))

    kbn = GameState()
    empty_board(kbn)
    kbn.board[7][4] = 'K'; kbn.board[0][4] = 'k'
    kbn.board[7][2] = 'B'; kbn.board[7][1] = 'N'
    check("KBN vs K 可杀 ≠ 子力不足", not Rules.is_insufficient_material(kbn))

    kr = GameState()
    empty_board(kr)
    kr.board[7][4] = 'K'; kr.board[0][4] = 'k'; kr.board[7][0] = 'R'
    check("K + 车 vs K 可杀 ≠ 子力不足", not Rules.is_insufficient_material(kr))


# ---------- 21. AI 深度 3 性能 ----------
def test_depth3_timing() -> None:
    s = GameState()
    s = play(s, 6, 4, 4, 4); s = play(s, 1, 4, 3, 4)
    s = play(s, 7, 6, 5, 5); s = play(s, 0, 1, 2, 2)
    s = play(s, 7, 5, 4, 2); s = play(s, 0, 6, 2, 5)
    t0 = time.perf_counter()
    best = AIEngine.find_best_move(s, 3)
    t1 = time.perf_counter()
    is_legal = False
    if best is not None:
        for m in Rules.generate_all_legal_moves(s):
            if (m.fromRow == best.fromRow and m.fromCol == best.fromCol and
                    m.toRow == best.toRow and m.toCol == best.toCol):
                is_legal = True
    check("AI 深度 3 返回合法走法", is_legal)
    ms = (t1 - t0) * 1000.0
    check("AI 深度 3 中局搜索 < 2 秒", ms < 2000)


# ---------- 22. 角格车被吃后撤销易位权 ----------
def test_castling_right_revoked_on_rook_capture() -> None:
    s = GameState()
    empty_board(s)
    s.board[7][4] = 'K'; s.board[7][7] = 'R'
    s.board[0][7] = 'r'; s.board[0][4] = 'k'
    s.whiteToMove = False
    s.canCastleWK = s.canCastleWQ = s.canCastleBK = s.canCastleBQ = True

    move = None
    for m in Rules.generate_legal_moves(s, 0, 7):
        if m.toRow == 7 and m.toCol == 7:
            move = m
    check("黑车可走到 h1 吃掉白车", move is not None)
    after = s.clone()
    Rules.apply_move(after, move)
    check("角格白车被吃后白方失去短易位权", not after.canCastleWK)
    check("黑车已占领 h1", after.board[7][7] == 'r')


# ---------- 23. 退化局面 ----------
def test_degenerate_positions() -> None:
    empty = GameState()
    empty_board(empty)
    check("空盘 a1 不被攻击",
          not Rules.is_attacked(empty.board, 7, 0, True) and
          not Rules.is_attacked(empty.board, 7, 0, False))
    check("空盘 e4 不被攻击",
          not Rules.is_attacked(empty.board, 4, 4, True) and
          not Rules.is_attacked(empty.board, 4, 4, False))

    kk = GameState()
    empty_board(kk)
    kk.board[7][4] = 'K'; kk.board[0][4] = 'k'
    bm = AIEngine.find_best_move(kk, 1)
    check("K vs K 局面 FindBestMove 有值（王可走）", bm is not None)

    mate = GameState()
    mate = play(mate, 6, 4, 4, 4); mate = play(mate, 1, 4, 3, 4)
    mate = play(mate, 7, 5, 4, 2); mate = play(mate, 0, 1, 2, 2)
    mate = play(mate, 7, 3, 3, 7); mate = play(mate, 0, 6, 2, 5)
    mate = play(mate, 3, 7, 1, 5)   # Qxf7#
    mate_move = AIEngine.find_best_move(mate, 1)
    check("将死局面 FindBestMove = Nothing", mate_move is None)


# ---------- 24. 升变 SAN 记谱 ----------
def test_promotion_san() -> None:
    s = GameState()
    empty_board(s)
    s.board[1][4] = 'P'; s.board[7][4] = 'K'; s.board[0][7] = 'k'
    qmove = None
    for m in Rules.generate_legal_moves(s, 1, 4):
        if m.special == SpecialMove.Promotion and m.promotion == 'Q':
            qmove = m
    check("升后走法存在", qmove is not None)
    if qmove is not None:
        san = qmove.to_string()
        check("升变 SAN 含 =Q", "=Q" in san)
        check("升变 SAN = e8=Q", san == "e8=Q")


# ---------- 25. perft 黄金值（走法生成正确性交叉验证） ----------
def test_perft() -> None:
    # Pos1 起始局面
    p1 = setup_position(
        ["rnbqkbnr", "pppppppp", "........", "........",
         "........", "........", "PPPPPPPP", "RNBQKBNR"], "KQkq")
    check("perft Pos1 d1 = 20", perft(p1, 1) == 20)
    check("perft Pos1 d2 = 400", perft(p1, 2) == 400)
    check("perft Pos1 d3 = 8902", perft(p1, 3) == 8902)
    check("perft Pos1 d4 = 197281", perft(p1, 4) == 197281)

    # Pos2 Kiwipete
    p2 = setup_position(
        ["r3k2r", "p1ppqpb1", "bn2pnp1", "3PN3",
         "1p2P3", "2N2Q1p", "PPPBBPPP", "R3K2R"], "KQkq")
    check("perft Pos2 d1 = 48", perft(p2, 1) == 48)
    check("perft Pos2 d2 = 2039", perft(p2, 2) == 2039)
    check("perft Pos2 d3 = 97862", perft(p2, 3) == 97862)
    # check("perft Pos2 d4 = 4085603", perft(p2, 4) == 4085603)  # >2M 节点，CPython 过慢，仅作参考

    # Pos3 Wiki3  (注意：规范 Position 3 的 rank2 为 "4P1P1"；
    # 用户所给 "PPP3PP" 会得到 16/204/3320/45627，与本黄金值不符，
    # 此处采用与黄金值 14/191/2812/43238 对应的规范 FEN。)
    p3 = setup_position(
        ["8", "2p5", "3p4", "KP5r",
         "1R3p1k", "8", "4P1P1", "8"], "")
    check("perft Pos3 d1 = 14", perft(p3, 1) == 14)
    check("perft Pos3 d2 = 191", perft(p3, 2) == 191)
    check("perft Pos3 d3 = 2812", perft(p3, 3) == 2812)
    check("perft Pos3 d4 = 43238", perft(p3, 4) == 43238)

    # Pos4 Wiki5
    p4 = setup_position(
        ["rnbq1k1r", "pp1Pbppp", "2p5", "8",
         "2B5", "8", "PPP1NnPP", "RNBQK2R"], "KQ")
    check("perft Pos4 d1 = 44", perft(p4, 1) == 44)
    check("perft Pos4 d2 = 1486", perft(p4, 2) == 1486)
    check("perft Pos4 d3 = 62379", perft(p4, 3) == 62379)
    # check("perft Pos4 d4 = 2103487", perft(p4, 4) == 2103487)  # >2M 节点，CPython 过慢，仅作参考


def run_tests() -> int:
    test_initial_position()
    test_is_attacked_basics()
    test_pawn_double_and_en_passant()
    test_castling()
    test_promotion()
    test_scholar_mate()
    test_fool_mate()
    test_stalemate()
    test_insufficient_material()
    test_fifty_move_counter()
    test_threefold_repetition()
    test_evaluation()
    test_negamax_terminal_scores()
    test_ai_finds_mate()
    test_ai_captures_free_queen()
    test_ai_choose_reasonable_opening()
    test_pinned_piece()
    test_check_evasion()
    test_en_passant_reveal_check()
    test_insufficient_material_extended()
    test_depth3_timing()
    test_castling_right_revoked_on_rook_capture()
    test_degenerate_positions()
    test_promotion_san()
    test_perft()

    print("\n========================================")
    print(f"RESULT: {_pass} passed, {_fail} failed")
    print("========================================")
    return _fail


if __name__ == "__main__":
    import sys
    sys.exit(0 if run_tests() == 0 else 1)
