// tournament/reference_search.mjs
//
// A spec-canonical reference AI, implemented DIRECTLY from lab/port_spec.txt §3
// on top of the tournament's own authoritative rules engine (engine.mjs).
//
// Why this file exists:
//   In the daily tournament report, most games came out byte-identical, and the
//   engines that diverged (go, vb) could not be judged from the report alone —
//   you cannot tell diverging *ports* apart from diverging *strength* without an
//   independent adjudicator. This module IS that adjudicator: it re-implements
//   the spec's pseudo-code verbatim (same constants, same PST tables, same
//   negamax / quiescence / move ordering) using engine.mjs for movegen, so it is
//   independent of all six language ports.
//
// Two entry points:
//   findBestMove(state, depth)          -> UCI string | null   (spec §3 root loop)
//   rootMoveScores(state, depth)        -> [{uci, score}]      (full-window, no
//                                                               alpha-beta narrowing)
//
// `rootMoveScores` uses a FULL window per child (-INF, INF) so every root move
// gets its true minimax value, not a fail-low bound. It is much slower and is
// only used to decide whether a divergence is a genuine mistake or merely a tie
// between equally-scored moves (in which case the winner depends on move-order
// details the spec leaves undefined — see the parity report).

import * as E from './engine.mjs';

const MATE = 900000;
const INF = 1000000;

// spec: PieceValue[7] = {0, 100, 320, 330, 500, 900, 0}
const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

// spec: PST tables, white point of view, row0..row7, columns a..h
const PST = {
  P: [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0,
  ],
  N: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  B: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  R: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
  ],
  Q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  K: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

function pieceIndex(p) {
  switch (p.toUpperCase()) {
    case 'P': return 1;
    case 'N': return 2;
    case 'B': return 3;
    case 'R': return 4;
    case 'Q': return 5;
    case 'K': return 6;
    default: return 0;
  }
}

// spec Evaluate(): white perspective, black uses the row-mirrored white table.
function evaluate(state) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p === '.') continue;
      const idx = pieceIndex(p);
      const t = p.toUpperCase();
      const table = PST[t];
      if (p >= 'A' && p <= 'Z') score += PIECE_VALUE[idx] + table[r * 8 + c];
      else score -= PIECE_VALUE[idx] + table[(7 - r) * 8 + c];
    }
  }
  return score;
}

function evaluateSide(state) {
  const s = evaluate(state);
  return state.whiteToMove ? s : -s;
}

// spec MoveOrderScore: quiet = 0, capture = victim*10 - attacker
function moveOrderScore(m) {
  if (!m.captured || m.captured === '.') return 0;
  return PIECE_VALUE[pieceIndex(m.captured)] * 10 - PIECE_VALUE[pieceIndex(m.piece)];
}

// spec OrderMoves: descending MoveOrderScore. Array.prototype.sort is stable in
// V8, which is what defines the canonical tie order here.
function orderMoves(moves) {
  return [...moves].sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
}

function quiescence(state, alpha, beta, qdepth) {
  const stand = evaluateSide(state);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth >= 4) return alpha;
  const moves = orderMoves(E.generateAllLegalMoves(state).filter((m) => m.captured !== '.'));
  for (const m of moves) {
    const child = E.applyMove(state, m, false);
    const score = -quiescence(child, -beta, -alpha, qdepth + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, ply) {
  const moves = E.generateAllLegalMoves(state);
  if (moves.length === 0) {
    if (E.isCheck(state, state.whiteToMove)) return -MATE + ply; // mated
    return 0;                                                    // stalemate
  }
  if (depth <= 0) return quiescence(state, alpha, beta, 0);
  let best = -INF;
  for (const m of orderMoves(moves)) {
    const child = E.applyMove(state, m, false);
    const score = -negamax(child, depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// spec FindBestMove(): order root moves, strictly-greater update, no beta cutoff.
function findBestMove(state, depth) {
  const moves = E.generateAllLegalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return E.moveToUci(moves[0]);
  const ordered = orderMoves(moves);
  let bestMove = ordered[0];
  let bestScore = -INF;
  let alpha = -INF;
  const beta = INF;
  for (const m of ordered) {
    const child = E.applyMove(state, m, false);
    const score = -negamax(child, depth - 1, -beta, -alpha, 1);
    if (score > bestScore) { bestScore = score; bestMove = m; }
    if (score > alpha) alpha = score;
  }
  return E.moveToUci(bestMove);
}

// Every root move scored with a FULL window — its true minimax value, not a
// fail-low bound. Slow; only used to adjudicate divergences (tie vs mistake).
function rootMoveScores(state, depth) {
  const moves = orderMoves(E.generateAllLegalMoves(state));
  const out = [];
  for (const m of moves) {
    const child = E.applyMove(state, m, false);
    const score = -negamax(child, depth - 1, -INF, INF, 1);
    out.push({ uci: E.moveToUci(m), score });
  }
  return out;
}

export {
  MATE, INF, PIECE_VALUE, PST, evaluate, evaluateSide,
  moveOrderScore, orderMoves, quiescence, negamax, findBestMove, rootMoveScores,
};
