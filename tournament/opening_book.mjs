// tournament/opening_book.mjs
//
// A small, self-contained opening book for the cross-language tournament.
//
// WHY: at depth=4 every engine shares the same material+PST evaluation (the PST
// weights are literally copied across languages — see chess_ai.go:21 "PST 逐字复制
// C++"). So all 10 engines converge on the same lines and threefold repetition
// draws dominate. Playing a few random *legal* opening moves before handing the
// position to the engines diversifies the starting position per game, which is the
// single highest-leverage, lowest-risk way to cut repetitive games — and it is
// 100% runner-side, so it touches none of the 10 engine cores.
//
// The book is just an array of named UCI move sequences. A self-test (run at
// import time) replays every line through the authoritative engine.mjs and throws
// on the first illegal move, so a bad entry fails fast with a clear message.

import * as E from './engine.mjs';

// Default number of opening plies to pre-play each game (0 disables the book).
export const OPENING_PLIES_DEFAULT = 6;

// Curated, well-known opening lines. Each entry is a list of UCI moves starting
// from the standard initial position. Variety in *first moves* matters most for
// diversification, so the book spans 1.e4 / 1.d4 / 1.c4 / 1.Nf3 / 1... systems.
export const OPENINGS = [
  { name: 'Ruy Lopez',            uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
  { name: 'Italian Game',         uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
  { name: 'Scotch Game',          uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4'] },
  { name: 'Four Knights',         uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b1c3', 'g8f6'] },
  { name: 'Petrov Defense',       uci: ['e2e4', 'e7e5', 'g1f3', 'g8f6'] },
  { name: 'Vienna Game',          uci: ['e2e4', 'e7e5', 'b1c3'] },
  { name: 'Bishop Opening',       uci: ['e2e4', 'e7e5', 'f1c4'] },
  { name: 'Spanish Exchange',     uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6'] },
  { name: 'Sicilian Najdorf',     uci: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'] },
  { name: 'Sicilian Open',        uci: ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4', 'f3d4'] },
  { name: 'French Defense',       uci: ['e2e4', 'e7e6', 'd2d4', 'd7d5'] },
  { name: 'Caro-Kann',            uci: ['e2e4', 'c7c6', 'd2d4', 'd7d5'] },
  { name: 'Scandinavian',         uci: ['e2e4', 'd7d5', 'e4d5', 'd8d5'] },
  { name: 'Alekhine Defense',     uci: ['e2e4', 'g8f6', 'e4e5', 'f6d5'] },
  { name: 'Pirc Defense',         uci: ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6'] },
  { name: 'Modern Defense',       uci: ['e2e4', 'g7g6', 'd2d4', 'f8g7'] },
  { name: 'Queen Gambit Declined', uci: ['d2d4', 'd7d5', 'c2c4', 'e7e6'] },
  { name: 'Slav Defense',         uci: ['d2d4', 'd7d5', 'c2c4', 'c7c6'] },
  { name: 'Queen Gambit Accepted', uci: ['d2d4', 'd7d5', 'c2c4', 'd5c4'] },
  { name: 'King Indian Defense',   uci: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7'] },
  { name: 'Nimzo-Indian',         uci: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'] },
  { name: 'Grünfeld',             uci: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5'] },
  { name: 'Benoni Defense',       uci: ['d2d4', 'g8f6', 'c2c4', 'c7c5', 'd4d5'] },
  { name: 'London System',        uci: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4'] },
  { name: 'Trompowsky',           uci: ['d2d4', 'g8f6', 'c1g5'] },
  { name: 'Queen Pawn + Bishop',   uci: ['d2d4', 'd7d5', 'c1f4'] },
  { name: 'English Opening',      uci: ['c2c4'] },
  { name: 'English Reversed Sic', uci: ['c2c4', 'e7e5', 'g1f3', 'b8c6', 'b1c3'] },
  { name: 'Réti Opening',         uci: ['g1f3', 'd7d5', 'c2c4'] },
  { name: 'Dutch Defense',        uci: ['d2d4', 'f7f5'] },
  { name: 'King Pawn Simple',     uci: ['e2e4', 'e7e5'] },
  { name: 'Scandinavian Alt',     uci: ['e2e4', 'd7d5'] },
];

// Replay an opening line through the authoritative engine to prove every move is
// legal. Throws on the first illegal move with a descriptive message.
export function validateBook() {
  for (const op of OPENINGS) {
    let state = E.parseFen(E.serializeFen(E.parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')));
    for (let i = 0; i < op.uci.length; i++) {
      try {
        state = E.applyUci(state, op.uci[i]);
      } catch (e) {
        throw new Error(`opening book entry "${op.name}" illegal at ply ${i + 1} (${op.uci[i]}): ${e.message}`);
      }
    }
  }
  return OPENINGS.length;
}

// Pick a random opening and return up to `plies` of its moves.
// Returns { name, moves } where moves is an array of UCI strings (length <= plies,
// and never longer than the line itself). `rng` defaults to Math.random.
export function pickOpening(plies, rng = Math.random) {
  const op = OPENINGS[Math.floor(rng() * OPENINGS.length)];
  const n = Math.max(0, Math.min(plies, op.uci.length));
  return { name: op.name, moves: op.uci.slice(0, n) };
}

// Self-test at import: fail fast if any book line is illegal. Importing this
// module is enough to validate (the tournament runner imports pickOpening, so the
// book is validated on every run start).
validateBook();
