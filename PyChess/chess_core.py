# =============================================================================
# chess_core.py — 国际象棋核心引擎（Python 3.13+）
# -----------------------------------------------------------------------------
# 与 CppChess\chess_core.h/.cpp 完全对等的移植。
# 架构：
#   1. 数据层：GameState（棋盘 + 行棋方 + 易位权 + 过路兵目标格 + 计数器）
#   2. 规则层：Rules（伪合法走法生成 → 在副本上模拟走子 → IsAttacked 过滤）
#   3. 终局层：将军 / 将死 / 逼和 / 50 步规则 / 子力不足 / 三次重复
#
# 棋盘表示（8x8 list[list[str]]）：
#   board[row][col]
#     row 0 = 第 8 横线（黑方底线，屏幕上方）
#     row 7 = 第 1 横线（白方底线，屏幕下方）
#   大写 = 白方棋子  K Q R B N P
#   小写 = 黑方棋子  k q r b n p
#   '.'   = 空格
#
# 核心思路：
#   - IsAttacked() 单一例程支撑整个规则库
#   - 合法走法 = 伪合法走法（几何规则） - 会使己方王被攻击的走法
# =============================================================================

from __future__ import annotations

from copy import deepcopy
from enum import IntEnum


# ---------------------------- 特殊走法类型 ----------------------------
class SpecialMove(IntEnum):
    None_ = 0          # 普通走法
    DoublePawn = 1     # 兵双重进兵（设置过路兵目标格）
    EnPassant = 2      # 吃过路兵
    CastleKingside = 3 # 短易位（王翼易位）
    CastleQueenside = 4# 长易位（后翼易位）
    Promotion = 5      # 兵升变


# ---------------------------- 走法结构 ----------------------------
class Move:
    __slots__ = (
        "fromRow", "fromCol", "toRow", "toCol",
        "piece", "captured", "special", "promotion",
    )

    def __init__(self, fromRow=0, fromCol=0, toRow=0, toCol=0,
                 piece='.', captured='.', special=SpecialMove.None_, promotion='.'):
        self.fromRow = fromRow
        self.fromCol = fromCol
        self.toRow = toRow
        self.toCol = toCol
        self.piece = piece
        self.captured = captured
        self.special = special
        self.promotion = promotion

    def is_capture(self) -> bool:
        return self.captured != '.'

    def __eq__(self, other) -> bool:
        if not isinstance(other, Move):
            return NotImplemented
        return (self.fromRow == other.fromRow and self.fromCol == other.fromCol and
                self.toRow == other.toRow and self.toCol == other.toCol and
                self.piece == other.piece and self.special == other.special and
                self.promotion == other.promotion)

    def __repr__(self) -> str:
        return self.to_string()

    # 长式代数记谱（无歧义）
    def to_string(self) -> str:
        if self.special == SpecialMove.CastleKingside:
            return "O-O"
        if self.special == SpecialMove.CastleQueenside:
            return "O-O-O"
        files = "abcdefgh"
        from_sq = files[self.fromCol] + str(8 - self.fromRow)
        to_sq = files[self.toCol] + str(8 - self.toRow)
        if self.piece == 'P' or self.piece == 'p':
            s = ""
            if self.is_capture():
                s += files[self.fromCol]  # 兵吃子记来源文件
            s += to_sq
            if self.special == SpecialMove.Promotion:
                s += '='
                s += self.promotion.upper()
            return s
        else:
            s = self.piece.upper()
            s += from_sq
            if self.is_capture():
                s += 'x'
            s += to_sq
            return s


# ---------------------------- 对局状态 ----------------------------
class GameState:
    def __init__(self):
        self.board: list[list[str]] = [['.' for _ in range(8)] for _ in range(8)]
        self.whiteToMove: bool = True
        # 易位权（跟踪王/车是否动过、角上车是否被吃）
        self.canCastleWK: bool = True
        self.canCastleWQ: bool = True
        self.canCastleBK: bool = True
        self.canCastleBQ: bool = True
        # 过路兵目标格（上一步双进兵跳过的格），-1 表示无
        self.enPassantRow: int = -1
        self.enPassantCol: int = -1
        # 50 步规则半步计数（吃子或动兵清零）
        self.halfmoveClock: int = 0
        self.fullmoveNumber: int = 1
        # 记谱历史（长式代数记谱）
        self.history: list[str] = []
        # 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
        self.positionKeys: list[str] = []
        # RepHistory：runner 传入的本局已出现局面键（engine.mjs 兼容键）及出现次数，
        # 用于评估层的重复惩罚。None 表示不惩罚（未提供历史）。搜索过程只读不写。
        self.rep_history: dict[str, int] | None = None
        self.reset_to_start_position()

    def reset_to_start_position(self) -> None:
        back = "rnbqkbnr"
        for c in range(8):
            self.board[0][c] = back[c]
            self.board[1][c] = 'p'
            self.board[2][c] = '.'
            self.board[3][c] = '.'
            self.board[4][c] = '.'
            self.board[5][c] = '.'
            self.board[6][c] = 'P'
            self.board[7][c] = back[c].upper()
        self.whiteToMove = True
        self.canCastleWK = self.canCastleWQ = self.canCastleBK = self.canCastleBQ = True
        self.enPassantRow = self.enPassantCol = -1
        self.halfmoveClock = 0
        self.fullmoveNumber = 1
        self.history.clear()
        self.positionKeys.clear()
        self.positionKeys.append(self.get_position_key())

    # 局面键：影响重复判定的全部状态
    def get_position_key(self) -> str:
        s = []
        for r in range(8):
            for c in range(8):
                s.append(self.board[r][c])
        s.append('w' if self.whiteToMove else 'b')
        s.append('K' if self.canCastleWK else '-')
        s.append('Q' if self.canCastleWQ else '-')
        s.append('k' if self.canCastleBK else '-')
        s.append('q' if self.canCastleBQ else '-')
        if Rules.has_legal_en_passant(self):
            s.append(str(self.enPassantRow))
            s.append(',')
            s.append(str(self.enPassantCol))
        else:
            s.append("-1,-1")
        return ''.join(s)

    # 局面键（engine.mjs 兼容）：与 engine.mjs 的 getPositionKey 完全一致。
    #   · 易位权不加 '-' 分隔符（KQkq 直接拼接，缺失则拼接空串）
    #   · 过路兵用存储值（enPassantRow/Col），不调用 has_legal_en_passant
    # runner 传来的重复惩罚比对使用此键，格式必须两端一致，否则惩罚永不触发。
    def position_key_simple(self) -> str:
        s = []
        for r in range(8):
            for c in range(8):
                s.append(self.board[r][c])
        s.append('w' if self.whiteToMove else 'b')
        if self.canCastleWK:
            s.append('K')
        if self.canCastleWQ:
            s.append('Q')
        if self.canCastleBK:
            s.append('k')
        if self.canCastleBQ:
            s.append('q')
        if self.enPassantRow >= 0 and self.enPassantCol >= 0:
            s.append(str(self.enPassantRow))
            s.append(',')
            s.append(str(self.enPassantCol))
        else:
            s.append("-1,-1")
        return ''.join(s)

    # 深拷贝（含记谱与局面键）
    def clone(self) -> "GameState":
        s = GameState.__new__(GameState)
        s.board = [row[:] for row in self.board]
        s.whiteToMove = self.whiteToMove
        s.canCastleWK = self.canCastleWK
        s.canCastleWQ = self.canCastleWQ
        s.canCastleBK = self.canCastleBK
        s.canCastleBQ = self.canCastleBQ
        s.enPassantRow = self.enPassantRow
        s.enPassantCol = self.enPassantCol
        s.halfmoveClock = self.halfmoveClock
        s.fullmoveNumber = self.fullmoveNumber
        s.history = list(self.history)
        s.positionKeys = list(self.positionKeys)
        s.rep_history = self.rep_history  # 共享只读引用，搜索不修改
        return s

    # 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝）
    def clone_light(self) -> "GameState":
        s = GameState.__new__(GameState)
        s.board = [row[:] for row in self.board]
        s.whiteToMove = self.whiteToMove
        s.canCastleWK = self.canCastleWK
        s.canCastleWQ = self.canCastleWQ
        s.canCastleBK = self.canCastleBK
        s.canCastleBQ = self.canCastleBQ
        s.enPassantRow = self.enPassantRow
        s.enPassantCol = self.enPassantCol
        s.halfmoveClock = self.halfmoveClock
        s.fullmoveNumber = self.fullmoveNumber
        s.history = []
        s.positionKeys = []
        s.rep_history = self.rep_history  # 共享只读引用，搜索不修改
        return s


# ---------------------------- 规则引擎 ----------------------------
class Rules:
    # ===== 基础工具 =====
    @staticmethod
    def in_board(r: int, c: int) -> bool:
        return 0 <= r <= 7 and 0 <= c <= 7

    @staticmethod
    def is_white_piece(p: str) -> bool:
        return p != '.' and p.isupper()

    @staticmethod
    def is_black_piece(p: str) -> bool:
        return p != '.' and p.islower()

    @staticmethod
    def is_piece_of_side(p: str, white: bool) -> bool:
        if p == '.':
            return False
        return p.isupper() if white else p.islower()

    # ===== IsAttacked：单一例程支撑整个规则库 =====
    @staticmethod
    def is_attacked(board: list[list[str]], r: int, c: int, by_white: bool) -> bool:
        # --- 1. 兵攻击（白兵攻击其上方两斜格，黑兵反之） ---
        pawn = 'P' if by_white else 'p'
        pr = r + 1 if by_white else r - 1
        if 0 <= pr <= 7:
            if c - 1 >= 0 and board[pr][c - 1] == pawn:
                return True
            if c + 1 <= 7 and board[pr][c + 1] == pawn:
                return True

        # --- 2. 马攻击（8 个 L 形跳位） ---
        knight = 'N' if by_white else 'n'
        dr2 = (-2, -2, -1, -1, 1, 1, 2, 2)
        dc2 = (-1, 1, -2, 2, -2, 2, -1, 1)
        for i in range(8):
            tr = r + dr2[i]
            tc = c + dc2[i]
            if Rules.in_board(tr, tc) and board[tr][tc] == knight:
                return True

        # --- 3. 王攻击（8 邻格） ---
        king = 'K' if by_white else 'k'
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                tr = r + dr
                tc = c + dc
                if Rules.in_board(tr, tc) and board[tr][tc] == king:
                    return True

        # --- 4. 滑动射线攻击：直线（车/后）+ 斜线（象/后） ---
        rook = 'R' if by_white else 'r'
        queen = 'Q' if by_white else 'q'
        bishop = 'B' if by_white else 'b'
        dir_r = (-1, 1, 0, 0, -1, -1, 1, 1)
        dir_c = (0, 0, -1, 1, -1, 1, -1, 1)
        for i in range(8):
            tr = r + dir_r[i]
            tc = c + dir_c[i]
            while Rules.in_board(tr, tc):
                p = board[tr][tc]
                if p != '.':
                    if i < 4:
                        if p == rook or p == queen:
                            return True
                    else:
                        if p == bishop or p == queen:
                            return True
                    break
                tr += dir_r[i]
                tc += dir_c[i]
        return False

    # ===== 兵走法 =====
    @staticmethod
    def _generate_pawn_moves(lst: list[Move], state: GameState,
                             r: int, c: int, is_white: bool, enemy_pawn: str) -> None:
        b = state.board
        direction = -1 if is_white else 1
        start_row = 6 if is_white else 1

        # 前进一格（目标格须为空）
        if Rules.in_board(r + direction, c) and b[r + direction][c] == '.':
            Rules._add_pawn_move(lst, r, c, r + direction, c, '.', SpecialMove.None_, is_white)
            # 起始位置双重进兵
            if r == start_row and b[r + 2 * direction][c] == '.':
                m = Move(r, c, r + 2 * direction, c, b[r][c], '.', SpecialMove.DoublePawn, '.')
                lst.append(m)

        # 斜吃 / 吃过路兵
        for dc in (-1, 1):
            tr = r + direction
            tc = c + dc
            if not Rules.in_board(tr, tc):
                continue
            target = b[tr][tc]
            if target != '.' and Rules.is_piece_of_side(target, not is_white):
                Rules._add_pawn_move(lst, r, c, tr, tc, target, SpecialMove.None_, is_white)
            elif tr == state.enPassantRow and tc == state.enPassantCol:
                Rules._add_pawn_move(lst, r, c, tr, tc, enemy_pawn, SpecialMove.EnPassant, is_white)

    @staticmethod
    def _add_pawn_move(lst: list[Move], fr: int, fc: int, tr: int, tc: int,
                      captured: str, special: SpecialMove, is_white: bool) -> None:
        if tr == 0 or tr == 7:
            promos = "QRBN"
            for i in range(4):
                m = Move(fr, fc, tr, tc, 'P' if is_white else 'p',
                         captured, SpecialMove.Promotion,
                         promos[i] if is_white else promos[i].lower())
                lst.append(m)
        else:
            m = Move(fr, fc, tr, tc, 'P' if is_white else 'p',
                     captured, special, '.')
            lst.append(m)

    # ===== 马/王固定偏移 =====
    @staticmethod
    def _generate_offset_moves(lst: list[Move], board: list[list[str]],
                              r: int, c: int, is_white: bool,
                              dr: tuple, dc: tuple, n: int) -> None:
        p = board[r][c]
        for i in range(n):
            tr = r + dr[i]
            tc = c + dc[i]
            if not Rules.in_board(tr, tc):
                continue
            target = board[tr][tc]
            if target == '.' or Rules.is_piece_of_side(target, not is_white):
                m = Move(r, c, tr, tc, p, target, SpecialMove.None_, '.')
                lst.append(m)

    # ===== 象/车/后滑动 =====
    @staticmethod
    def _generate_sliding_moves(lst: list[Move], board: list[list[str]],
                               r: int, c: int, is_white: bool,
                               dr: tuple, dc: tuple, n: int) -> None:
        p = board[r][c]
        for i in range(n):
            tr = r + dr[i]
            tc = c + dc[i]
            while Rules.in_board(tr, tc):
                target = board[tr][tc]
                if target == '.':
                    m = Move(r, c, tr, tc, p, '.', SpecialMove.None_, '.')
                    lst.append(m)
                else:
                    if Rules.is_piece_of_side(target, not is_white):
                        m = Move(r, c, tr, tc, p, target, SpecialMove.None_, '.')
                        lst.append(m)
                    break
                tr += dr[i]
                tc += dc[i]

    # ===== 王车易位 =====
    @staticmethod
    def _generate_castling_moves(lst: list[Move], state: GameState,
                                 r: int, c: int, is_white: bool) -> None:
        b = state.board
        if is_white:
            if r != 7 or c != 4:
                return
            # 白方短易位：K e1→g1，R h1→f1
            if state.canCastleWK and b[7][7] == 'R' and b[7][5] == '.' and b[7][6] == '.':
                if (not Rules.is_attacked(b, 7, 4, False) and
                        not Rules.is_attacked(b, 7, 5, False) and
                        not Rules.is_attacked(b, 7, 6, False)):
                    m = Move(7, 4, 7, 6, 'K', '.', SpecialMove.CastleKingside, '.')
                    lst.append(m)
            # 白方长易位：K e1→c1，R a1→d1
            if state.canCastleWQ and b[7][0] == 'R' and b[7][1] == '.' and b[7][2] == '.' and b[7][3] == '.':
                if (not Rules.is_attacked(b, 7, 4, False) and
                        not Rules.is_attacked(b, 7, 3, False) and
                        not Rules.is_attacked(b, 7, 2, False)):
                    m = Move(7, 4, 7, 2, 'K', '.', SpecialMove.CastleQueenside, '.')
                    lst.append(m)
        else:
            if r != 0 or c != 4:
                return
            # 黑方短易位：K e8→g8，R h8→f8
            if state.canCastleBK and b[0][7] == 'r' and b[0][5] == '.' and b[0][6] == '.':
                if (not Rules.is_attacked(b, 0, 4, True) and
                        not Rules.is_attacked(b, 0, 5, True) and
                        not Rules.is_attacked(b, 0, 6, True)):
                    m = Move(0, 4, 0, 6, 'k', '.', SpecialMove.CastleKingside, '.')
                    lst.append(m)
            # 黑方长易位：K e8→c8，R a8→d8
            if state.canCastleBQ and b[0][0] == 'r' and b[0][1] == '.' and b[0][2] == '.' and b[0][3] == '.':
                if (not Rules.is_attacked(b, 0, 4, True) and
                        not Rules.is_attacked(b, 0, 3, True) and
                        not Rules.is_attacked(b, 0, 2, True)):
                    m = Move(0, 4, 0, 2, 'k', '.', SpecialMove.CastleQueenside, '.')
                    lst.append(m)

    # ===== 伪合法走法生成入口 =====
    @staticmethod
    def generate_pseudo_moves(state: GameState, r: int, c: int) -> list[Move]:
        lst: list[Move] = []
        b = state.board
        p = b[r][c]
        if p == '.':
            return lst

        is_white = p.isupper()
        enemy_pawn = 'p' if is_white else 'P'

        up = p.upper()
        if up == 'P':
            Rules._generate_pawn_moves(lst, state, r, c, is_white, enemy_pawn)
        elif up == 'N':
            dr = (-2, -2, -1, -1, 1, 1, 2, 2)
            dc = (-1, 1, -2, 2, -2, 2, -1, 1)
            Rules._generate_offset_moves(lst, b, r, c, is_white, dr, dc, 8)
        elif up == 'K':
            dr = (-1, -1, -1, 0, 0, 1, 1, 1)
            dc = (-1, 0, 1, -1, 1, -1, 0, 1)
            Rules._generate_offset_moves(lst, b, r, c, is_white, dr, dc, 8)
            Rules._generate_castling_moves(lst, state, r, c, is_white)
        elif up == 'B':
            dr = (-1, -1, 1, 1)
            dc = (-1, 1, -1, 1)
            Rules._generate_sliding_moves(lst, b, r, c, is_white, dr, dc, 4)
        elif up == 'R':
            dr = (-1, 1, 0, 0)
            dc = (0, 0, -1, 1)
            Rules._generate_sliding_moves(lst, b, r, c, is_white, dr, dc, 4)
        elif up == 'Q':
            dr = (-1, 1, 0, 0, -1, -1, 1, 1)
            dc = (0, 0, -1, 1, -1, 1, -1, 1)
            Rules._generate_sliding_moves(lst, b, r, c, is_white, dr, dc, 8)
        return lst

    # ===== 合法走法（两阶段） =====
    @staticmethod
    def generate_legal_moves(state: GameState, r: int, c: int) -> list[Move]:
        legal: list[Move] = []
        pseudo = Rules.generate_pseudo_moves(state, r, c)
        if not pseudo:
            return legal

        mover_is_white = state.board[r][c].isupper()
        for m in pseudo:
            sim = state.clone_light()
            Rules.apply_move(sim, m, False)
            kr, kc = Rules.find_king(sim.board, mover_is_white)
            if not Rules.is_attacked(sim.board, kr, kc, not mover_is_white):
                legal.append(m)
        return legal

    @staticmethod
    def generate_all_legal_moves(state: GameState) -> list[Move]:
        all_moves: list[Move] = []
        for r in range(8):
            for c in range(8):
                if Rules.is_piece_of_side(state.board[r][c], state.whiteToMove):
                    all_moves.extend(Rules.generate_legal_moves(state, r, c))
        return all_moves

    # ===== 走子执行 =====
    @staticmethod
    def apply_move(state: GameState, m: Move, record_history: bool = True) -> None:
        b = state.board

        # 1. 移动棋子本体
        b[m.toRow][m.toCol] = m.piece
        b[m.fromRow][m.fromCol] = '.'

        # 2. 特殊走法处理
        if m.special == SpecialMove.DoublePawn:
            state.enPassantRow = (m.fromRow + m.toRow) // 2
            state.enPassantCol = m.fromCol
        elif m.special == SpecialMove.EnPassant:
            cap_row = m.toRow + 1 if m.piece == 'P' else m.toRow - 1
            b[cap_row][m.toCol] = '.'
        elif m.special == SpecialMove.CastleKingside:
            b[m.fromRow][5] = b[m.fromRow][7]
            b[m.fromRow][7] = '.'
        elif m.special == SpecialMove.CastleQueenside:
            b[m.fromRow][3] = b[m.fromRow][0]
            b[m.fromRow][0] = '.'
        elif m.special == SpecialMove.Promotion:
            b[m.toRow][m.toCol] = m.promotion

        # 3. 非双进兵时清除过路兵目标格
        if m.special != SpecialMove.DoublePawn:
            state.enPassantRow = -1
            state.enPassantCol = -1

        # 4. 更新易位权
        if m.piece == 'K':
            state.canCastleWK = False
            state.canCastleWQ = False
        elif m.piece == 'k':
            state.canCastleBK = False
            state.canCastleBQ = False
        if (m.fromRow == 7 and m.fromCol == 0) or (m.toRow == 7 and m.toCol == 0):
            state.canCastleWQ = False
        if (m.fromRow == 7 and m.fromCol == 7) or (m.toRow == 7 and m.toCol == 7):
            state.canCastleWK = False
        if (m.fromRow == 0 and m.fromCol == 0) or (m.toRow == 0 and m.toCol == 0):
            state.canCastleBQ = False
        if (m.fromRow == 0 and m.fromCol == 7) or (m.toRow == 0 and m.toCol == 7):
            state.canCastleBK = False

        # 5. 50 步规则计数
        if m.piece.upper() == 'P' or m.captured != '.':
            state.halfmoveClock = 0
        else:
            state.halfmoveClock += 1

        # 6. 回合切换与记谱
        if not state.whiteToMove:
            state.fullmoveNumber += 1
        state.whiteToMove = not state.whiteToMove
        if record_history:
            state.history.append(m.to_string())
            state.positionKeys.append(state.get_position_key())

    # ===== 王定位与将军检测 =====
    @staticmethod
    def find_king(board: list[list[str]], is_white: bool) -> tuple[int, int]:
        k = 'K' if is_white else 'k'
        for r in range(8):
            for c in range(8):
                if board[r][c] == k:
                    return (r, c)
        return (-1, -1)

    @staticmethod
    def is_in_check(state: GameState, is_white: bool) -> bool:
        kr, kc = Rules.find_king(state.board, is_white)
        if kr < 0:
            return False
        return Rules.is_attacked(state.board, kr, kc, not is_white)

    # ===== 终局判定 =====
    @staticmethod
    def is_checkmate(state: GameState) -> bool:
        return Rules.is_in_check(state, state.whiteToMove) and not Rules.generate_all_legal_moves(state)

    @staticmethod
    def is_stalemate(state: GameState) -> bool:
        return (not Rules.is_in_check(state, state.whiteToMove)) and not Rules.generate_all_legal_moves(state)

    @staticmethod
    def is_fifty_move_draw(state: GameState) -> bool:
        return state.halfmoveClock >= 100

    @staticmethod
    def has_legal_en_passant(state: GameState) -> bool:
        if state.enPassantRow < 0:
            return False
        pawn_rank = state.enPassantRow + 1 if state.whiteToMove else state.enPassantRow - 1
        if pawn_rank < 0 or pawn_rank > 7:
            return False
        pawn = 'P' if state.whiteToMove else 'p'
        for dc in (-1, 1):
            c = state.enPassantCol + dc
            if 0 <= c <= 7 and state.board[pawn_rank][c] == pawn:
                for m in Rules.generate_legal_moves(state, pawn_rank, c):
                    if m.special == SpecialMove.EnPassant:
                        return True
        return False

    @staticmethod
    def is_threefold_repetition(state: GameState) -> bool:
        if not state.positionKeys:
            return False
        cur = state.positionKeys[-1]
        count = sum(1 for k in state.positionKeys if k == cur)
        return count >= 3

    @staticmethod
    def is_insufficient_material(state: GameState) -> bool:
        white: list[tuple[int, int]] = []  # (r, c)
        black: list[tuple[int, int]] = []
        for r in range(8):
            for c in range(8):
                p = state.board[r][c]
                if p == '.' or p.upper() == 'K':
                    continue
                if p.upper() in ('P', 'R', 'Q'):
                    return False
                if p.isupper():
                    white.append((r, c))
                else:
                    black.append((r, c))
        total = len(white) + len(black)
        if total == 0:
            return True          # K vs K
        if total == 1:
            return True          # K + 单象 / 单马 vs K
        if total == 2:
            if len(white) == 1 and len(black) == 1:
                return True      # 各执一子
            side = white if len(white) == 2 else black
            a = state.board[side[0][0]][side[0][1]].upper()
            bchar = state.board[side[1][0]][side[1][1]].upper()
            if a == 'B' and bchar == 'B':
                color0 = (side[0][0] + side[0][1]) % 2
                color1 = (side[1][0] + side[1][1]) % 2
                return color0 == color1  # 同色格双象=和棋，异色格可杀
            if a == 'N' and bchar == 'N':
                return True      # 双马 vs K（和棋）
            return False
        return False
