// FEN <-> GameState adapter shared by the native JS/TS engine plugins.
// Cordis core + the 8 engines have NO FEN parser, so this module is the
// single translation point between the unified FEN protocol and each
// engine's concrete GameState layout.

// Parse a standard FEN string into { board, side, castling, ep }.
// board[r][c] uses r=0 for rank 8 (matching every engine: board[0]=rank8).
export function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  const side = parts[1] || 'w';
  const castling = parts[2] || '-';
  const ep = parts[3] || '-';
  const half = parts[4];
  const full = parts[5];

  const ranks = placement.split('/'); // ranks[0] = rank 8
  if (ranks.length !== 8) throw new Error(`FEN must have 8 ranks: ${fen}`);
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '9') {
        for (let i = 0; i < Number(ch); i++) row.push('.');
      } else {
        row.push(ch);
      }
    }
    if (row.length !== 8) throw new Error(`FEN rank ${r} has ${row.length} files: ${ranks[r]}`);
    board.push(row);
  }
  return { board, side, castling, ep, half, full };
}

// Build an engine GameState from a FEN, using the engine's own constructor
// (which initializes castling/en-passant/history fields) then overwriting.
export function buildGameState(GameStateClass, fen) {
  const { board, side, castling, ep, half, full } = parseFen(fen);
  const s = new GameStateClass();
  s.board = board;
  s.whiteToMove = side === 'w';
  s.canCastleWK = castling.includes('K');
  s.canCastleWQ = castling.includes('Q');
  s.canCastleBK = castling.includes('k');
  s.canCastleBQ = castling.includes('q');
  if (ep && ep !== '-') {
    const col = ep.charCodeAt(0) - 97; // 'a' -> 0
    const rank = Number(ep[1]);
    s.enPassantRow = 8 - rank; // row index (rank 8 = 0)
    s.enPassantCol = col;
  } else {
    s.enPassantRow = -1;
    s.enPassantCol = -1;
  }
  s.halfmoveClock = half ? Number(half) : 0;
  s.fullmoveNumber = full ? Number(full) : 1;
  s.history = [];
  s.positionKeys = [];
  return s;
}

// Engine-agnostic perft using the engine's OWN move generator + clone + apply.
// This is the heart of the cross-language proof: same FEN in, same node count
// out, regardless of which language computed it.
export function perftSync(Rules, GameStateClass, fen, depth) {
  const root = buildGameState(GameStateClass, fen);
  function rec(state, d) {
    if (d === 0) return 1;
    const moves = Rules.GenerateAllLegalMoves(state);
    if (d === 1) return moves.length;
    let count = 0;
    for (const m of moves) {
      const child = state.Clone();
      Rules.ApplyMove(child, m, false);
      count += rec(child, d - 1);
    }
    return count;
  }
  return rec(root, depth);
}
