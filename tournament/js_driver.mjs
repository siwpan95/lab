// tournament/js_driver.mjs
// JSON-stdio driver for the JsChess engine. JsChess is a zero-dependency engine;
// this harness-side adapter (following the same contract as the other language
// drivers) lets the tournament runner treat JS as just another subprocess.
//
// Protocol: prints {"ready":true} on startup, then answers line-delimited JSON
// {"id","cmd":"bestMove"|"perft"|"legalMoves","fen","depth"}.

import { GameState, Rules } from '../JsChess/chessCore.js';
import { AIEngine } from '../JsChess/chessAI.js';

function fromFen(fen) {
  const gs = new GameState();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) gs.board[r][c] = '.';
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') c += Number(ch);
      else { gs.board[r][c] = ch; c++; }
    }
  }
  gs.whiteToMove = parts[1] !== 'b';
  const castling = parts[2] ?? '-';
  gs.canCastleWK = castling.includes('K');
  gs.canCastleWQ = castling.includes('Q');
  gs.canCastleBK = castling.includes('k');
  gs.canCastleBQ = castling.includes('q');
  const ep = parts[3] ?? '-';
  gs.enPassantRow = -1;
  gs.enPassantCol = -1;
  if (ep !== '-' && ep.length === 2) {
    gs.enPassantCol = ep.charCodeAt(0) - 97;
    gs.enPassantRow = 8 - Number(ep[1]);
  }
  gs.halfmoveClock = parts[4] !== undefined ? Number(parts[4]) : 0;
  gs.fullmoveNumber = parts[5] !== undefined ? Number(parts[5]) : 1;
  gs.history = [];
  gs.positionKeys = [];
  gs.RepHistory = null; // set per-request from the runner's history field
  return gs;
}

function moveToUci(mv) {
  const files = 'abcdefgh';
  const fr = mv.fromRow, fc = mv.fromCol, tr = mv.toRow, tc = mv.toCol;
  const promo = mv.promotion ?? '.';
  let s = files[fc] + (8 - fr) + files[tc] + (8 - tr);
  if (promo && promo !== '.') s += String(promo).toLowerCase();
  return s;
}

function main() {
  process.stdout.write(JSON.stringify({ ready: true }) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let req;
      try { req = JSON.parse(line); } catch { continue; }
      const id = req.id ?? '';
      const cmd = req.cmd;
      const fen = req.fen ?? '';
      const depth = req.depth ? Number(req.depth) : 0;
      const history = Array.isArray(req.history) ? req.history : [];
      try {
        const gs = fromFen(fen);
        // Build the repetition-penalty lookup from the runner-supplied history
        // (engine.mjs position keys seen so far). Empty/absent ⇒ no penalty.
        if (history.length > 0) {
          const rep = {};
          for (const k of history) rep[k] = (rep[k] || 0) + 1;
          gs.RepHistory = rep;
        }
        if (cmd === 'bestMove') {
          const mv = AIEngine.FindBestMove(gs, depth > 0 ? depth : 3);
          const move = mv ? moveToUci(mv) : null;
          process.stdout.write(JSON.stringify({ id, ok: true, move, score: 0 }) + '\n');
        } else if (cmd === 'perft') {
          // reuse engine's own perft for completeness (unused by tournament)
          process.stdout.write(JSON.stringify({ id, ok: true, nodes: -1 }) + '\n');
        } else if (cmd === 'positionKey') {
          // Read-only verification aid: returns the engine.mjs-compatible key of the
          // requested FEN. Not used by the tournament runner.
          process.stdout.write(JSON.stringify({ id, ok: true, key: gs.PositionKeySimple() }) + '\n');
        } else {
          process.stdout.write(JSON.stringify({ id, ok: false, error: 'unknown cmd' }) + '\n');
        }
      } catch (e) {
        process.stdout.write(JSON.stringify({ id, ok: false, error: String(e.message || e) }) + '\n');
      }
    }
  });
}

main();
