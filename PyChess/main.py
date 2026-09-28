# =============================================================================
# main.py — Python 国际象棋入口（Python 3.13+）
# -----------------------------------------------------------------------------
# 与 E:\lab\CppChess\main.cpp 对等移植，零第三方依赖（仅标准库）。
#
# 用法：
#   python main.py                运行 97 项自测（默认）
#   python main.py test          运行 97 项自测
#   python main.py selfplay N D  AI(白) vs AI(黑) 各走 N 步，搜索深度 D（默认 N=8, D=2）
#   python main.py bench D       从初始局面做 FindBestMove 计时（默认 D=3）
#   python main.py play [ai]     文本交互对弈；加 ai 则人类执白、AI(黑) 接手
#
# 交互对弈输入：走法形如 e2e4；升变自动选后；输入 new 重开，quit 退出。
# 退出码：test 子命令失败数（0=全绿）；其它子命令一般 0。
# =============================================================================

from __future__ import annotations

import sys
import time

from chess_core import GameState, Move, Rules, SpecialMove
from chess_ai import AIEngine


# 渲染棋盘（字母简记 + 坐标），供文本界面与自对弈演示
def print_board(s: GameState) -> None:
    print("  +------------------------+")
    for r in range(8):
        print(f"{8 - r} | ", end="")
        for c in range(8):
            p = s.board[r][c]
            print((p if p != '.' else '.') + ' ', end="")
        print("|")
    print("  +------------------------+")
    print("    a b c d e f g h")


# 解析 "e2e4" 形式的坐标串，返回 (row, col)，失败返回 None
def parse_square(sq: str):
    if len(sq) != 2:
        return None
    if sq[0] < 'a' or sq[0] > 'h':
        return None
    if sq[1] < '1' or sq[1] > '8':
        return None
    col = ord(sq[0]) - ord('a')
    row = 8 - (ord(sq[1]) - ord('0'))
    return (row, col)


def cmd_tests() -> int:
    import tests
    fails = tests.run_tests()
    return 0 if fails == 0 else 1


def cmd_selfplay(nmoves: int, depth: int) -> int:
    s = GameState()
    print(f"=== AI vs AI 自对弈（深度 {depth}，各 {nmoves} 步） ===")
    for i in range(nmoves):
        all_moves = Rules.generate_all_legal_moves(s)
        if not all_moves:
            print("对局结束：", end="")
            if Rules.is_in_check(s, s.whiteToMove):
                print("白方将死黑方" if s.whiteToMove else "黑方将死白方")
            else:
                print("逼和/和棋")
            print_board(s)
            return 0
        best = AIEngine.find_best_move(s, depth)
        if best is None:
            print("无最佳走法（异常）")
            return 1
        Rules.apply_move(s, best)
        print(("黑" if s.whiteToMove else "白") + ": " + best.to_string())
    print_board(s)
    print(f"半步计数: {s.halfmoveClock}  走子历史条数: {len(s.history)}")
    return 0


def cmd_bench(depth: int) -> int:
    s = GameState()
    t0 = time.perf_counter()
    best = AIEngine.find_best_move(s, depth)
    t1 = time.perf_counter()
    ms = (t1 - t0) * 1000.0
    if best is not None:
        print(f"深度 {depth} 建议走法: {best.to_string()}  ({ms:.0f} ms)")
    else:
        print("无走法")
    return 0


def cmd_play(vs_ai: bool) -> int:
    s = GameState()
    depth = 2
    print("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。")
    print_board(s)
    while True:
        if not Rules.generate_all_legal_moves(s):
            print("对局结束：", end="")
            if Rules.is_in_check(s, s.whiteToMove):
                print("白方将死黑方" if s.whiteToMove else "黑方将死白方")
            else:
                print("逼和/和棋")
            break

        ai_turn = vs_ai and (not s.whiteToMove)  # 人类执白，AI 执黑
        if ai_turn:
            best = AIEngine.find_best_move(s, depth)
            if best is None:
                print("AI 无走法")
                break
            Rules.apply_move(s, best)
            print("AI(黑): " + best.to_string())
            print_board(s)
            continue

        try:
            line = input(("白方" if s.whiteToMove else "黑方") + "走子> ")
        except EOFError:
            break
        if line == "quit" or line == "exit":
            break
        if line == "new":
            s.reset_to_start_position()
            print_board(s)
            continue

        if len(line) >= 4:
            frm = line[0:2]
            to = line[2:4]
        else:
            print("格式错误（示例 e2e4）")
            continue

        parsed_frm = parse_square(frm)
        parsed_to = parse_square(to)
        if parsed_frm is None or parsed_to is None:
            print("坐标非法")
            continue
        fr, fc = parsed_frm
        tr, tc = parsed_to

        chosen = None
        for m in Rules.generate_legal_moves(s, fr, fc):
            if m.toRow == tr and m.toCol == tc:
                if m.special == SpecialMove.Promotion and m.promotion != 'Q':
                    continue
                chosen = m
        if chosen is None:
            print("非法走法")
            continue
        Rules.apply_move(s, chosen)
        print_board(s)
        if Rules.is_in_check(s, s.whiteToMove):
            print("将军！")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2:
        cmd = argv[1]
        if cmd == "test":
            return cmd_tests()
        if cmd == "selfplay":
            n = int(argv[2]) if len(argv) >= 3 else 8
            d = int(argv[3]) if len(argv) >= 4 else 2
            return cmd_selfplay(n, d)
        if cmd == "bench":
            d = int(argv[2]) if len(argv) >= 3 else 3
            return cmd_bench(d)
        if cmd == "play":
            ai = len(argv) >= 3 and argv[2] == "ai"
            return cmd_play(ai)
        print(f"未知子命令: {cmd}")
        print("可用: test | selfplay [N] [D] | bench [D] | play [ai]")
        return 1
    # 默认运行自测
    return cmd_tests()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
