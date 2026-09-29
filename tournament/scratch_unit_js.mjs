// scratch_unit_js.mjs — validates the JS repetition-penalty pilot (Tier 2-A).
// Run: node scratch_unit_js.mjs
import { GameState, Rules } from 'file:///D:/projects/lab/JsChess/chessCore.js';
import { AIEngine } from 'file:///D:/projects/lab/JsChess/chessAI.js';
import { parseFen, getPositionKey } from 'file:///D:/projects/lab/tournament/engine.mjs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};

// ---- helpers ----
function applyFen(gs, fen) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) gs.board[r][c] = '.';
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  for (let r = 0; r < 8; r++) { let c = 0; for (const ch of rows[r]) { if (ch >= '1' && ch <= '9') c += Number(ch); else { gs.board[r][c] = ch; c++; } } }
  gs.whiteToMove = parts[1] !== 'b';
  const cast = parts[2] ?? '-';
  gs.canCastleWK = cast.includes('K'); gs.canCastleWQ = cast.includes('Q');
  gs.canCastleBK = cast.includes('k'); gs.canCastleBQ = cast.includes('q');
  const ep = parts[3] ?? '-';
  gs.enPassantRow = -1; gs.enPassantCol = -1;
  if (ep !== '-' && ep.length === 2) { gs.enPassantCol = ep.charCodeAt(0) - 97; gs.enPassantRow = 8 - Number(ep[1]); }
  gs.halfmoveClock = parts[4] !== undefined ? Number(parts[4]) : 0;
  gs.fullmoveNumber = parts[5] !== undefined ? Number(parts[5]) : 1;
}

const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1',
  // en-passant target square set (the case that distinguishes GetPositionKey from PositionKeySimple)
  'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 1',
  'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  // partial castling rights (no dashes!) — tests KQkq-vs-K-Q-k-q mismatch
  'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
  '8/8/8/3k4/8/3K4/8/8 w - - 0 1',
];

// ---- 1. Parity: PositionKeySimple() must equal engine.mjs getPositionKey() byte-for-byte ----
for (const fen of FENS) {
  const gs = new GameState();
  applyFen(gs, fen);
  const estate = parseFen(fen);
  const a = gs.PositionKeySimple();
  const b = getPositionKey(estate);
  check('parity ' + fen.slice(0, 24), a === b, `\n  js =${a}\n  em =${b}`);
}

// ---- 2. Penalty magnitude: exact -60 per occurrence, white-perspective ----
{
  const gs = new GameState();
  const base = AIEngine.Evaluate(gs);
  gs.RepHistory = { [gs.PositionKeySimple()]: 2 };
  const pen = AIEngine.Evaluate(gs);
  check('penalty magnitude x2', pen === base - 120, `base=${base} pen=${pen} diff=${base - pen}`);
  const gs2 = new GameState();
  const base2 = AIEngine.Evaluate(gs2);
  gs2.RepHistory = { [gs2.PositionKeySimple()]: 1 };
  const pen2 = AIEngine.Evaluate(gs2);
  check('penalty magnitude x1', pen2 === base2 - 60, `diff=${base2 - pen2}`);
  const gs3 = new GameState();
  const base3 = AIEngine.Evaluate(gs3);
  gs3.RepHistory = {}; // present but empty ⇒ no penalty
  const pen3 = AIEngine.Evaluate(gs3);
  check('empty RepHistory ⇒ no penalty', pen3 === base3, `diff=${base3 - pen3}`);
}

// ---- 3. Behavioral: at depth 1 the child IS the leaf, so penalizing its key
//         must lower its move-score and steer the search elsewhere. ----
function uci(mv) {
  if (!mv) return 'null';
  const files = 'abcdefgh';
  return files[mv.fromCol] + (8 - mv.fromRow) + files[mv.toCol] + (8 - mv.toRow);
}
// Replicate FindBestMove's per-move scoring so we can assert the delta directly.
function scoreMove(gs, mv, depth) {
  const child = gs.CloneLight(); // preserves RepHistory (as FindBestMove does)
  Rules.ApplyMove(child, mv, false);
  return -AIEngine.Negamax(child, depth - 1, -AIEngine.Infinity, AIEngine.Infinity, 1);
}
{
  const a = new GameState();
  const M0 = AIEngine.FindBestMove(a, 1);
  const child = new GameState();
  Rules.ApplyMove(child, M0, false);
  const childKey = child.PositionKeySimple();

  const scoreNoPen = scoreMove(a, M0, 1);

  const b = new GameState();
  b.RepHistory = { [childKey]: 1 };
  const scorePen = scoreMove(b, M0, 1); // same move M0, but its child now penalized

  console.log(`  behavioral: M0=${uci(M0)}  scoreNoPen=${scoreNoPen}  scorePen=${scorePen}  delta=${scoreNoPen - scorePen}`);
  check('penalized move scores lower', scorePen < scoreNoPen, `noPen=${scoreNoPen} pen=${scorePen}`);

  const M1 = AIEngine.FindBestMove(b, 1);
  check('search avoids repeating best move', uci(M0) !== uci(M1), `M0=${uci(M0)} M1=${uci(M1)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
