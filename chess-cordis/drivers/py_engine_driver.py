# chess-cordis harness-side driver for PyChess (NOT part of the engine).
# Imports the pure PyChess core and serves perft / bestMove over line-delimited JSON.
# The engine itself stays zero-dependency and cordis-unaware.
import sys
import json
sys.path.insert(0, "D:/projects/lab/PyChess")
from chess_core import GameState, Rules
from chess_ai import AIEngine


def from_fen(fen: str) -> GameState:
    """Build a GameState from a FEN, including castling/ep/halfmove/fullmove.

    Mirrors the engine's own setup so perft is exact for positions that carry
    castling rights or an en-passant target (Start, Kiwipete, ...)."""
    parts = fen.split()
    placement = parts[0]
    side = parts[1] if len(parts) > 1 else "w"
    castling = parts[2] if len(parts) > 2 else "-"
    ep = parts[3] if len(parts) > 3 else "-"
    halfmove = int(parts[4]) if len(parts) > 4 else 0
    fullmove = int(parts[5]) if len(parts) > 5 else 1

    s = GameState()
    s.board = [["." for _ in range(8)] for _ in range(8)]
    for r, rank_str in enumerate(placement.split("/")):  # r=0 -> rank 8
        c = 0
        for ch in rank_str:
            if ch.isdigit():
                c += int(ch)
            else:
                s.board[r][c] = ch
                c += 1

    s.whiteToMove = side == "w"
    s.canCastleWK = "K" in castling
    s.canCastleWQ = "Q" in castling
    s.canCastleBK = "k" in castling
    s.canCastleBQ = "q" in castling
    if ep != "-" and len(ep) == 2:
        s.enPassantCol = ord(ep[0]) - ord("a")
        s.enPassantRow = 8 - int(ep[1])
    else:
        s.enPassantRow = -1
        s.enPassantCol = -1
    s.halfmoveClock = halfmove
    s.fullmoveNumber = fullmove
    s.history.clear()
    s.positionKeys.clear()
    s.positionKeys.append(s.get_position_key())
    return s


def move_to_uci(mv) -> str:
    files = "abcdefgh"
    frm = files[mv.fromCol] + str(8 - mv.fromRow)
    to = files[mv.toCol] + str(8 - mv.toRow)
    uci = frm + to
    if mv.promotion not in (".", None):
        uci += str(mv.promotion).lower()
    return uci


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


def main() -> None:
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        cmd = req.get("cmd")
        fen = req.get("fen", "")
        depth = int(req.get("depth", 0))
        rid = req.get("id", "")
        try:
            state = from_fen(fen)
            if cmd == "perft":
                print(json.dumps({"id": rid, "ok": True, "nodes": perft(state, depth)}), flush=True)
            elif cmd == "legalMoves":
                print(json.dumps({"id": rid, "ok": True, "moves": len(Rules.generate_all_legal_moves(state))}), flush=True)
            elif cmd == "bestMove":
                mv = AIEngine.find_best_move(state, depth if depth > 0 else 2)
                print(json.dumps({"id": rid, "ok": True, "move": move_to_uci(mv) if mv else None, "score": 0}), flush=True)
            else:
                print(json.dumps({"id": rid, "ok": False, "error": "unknown cmd"}), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "ok": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
