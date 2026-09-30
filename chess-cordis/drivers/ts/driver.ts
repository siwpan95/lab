// =============================================================================
// driver.ts — chess-cordis harness-side JSON-stdio driver for TsChess
// -----------------------------------------------------------------------------
// Reuses the pure TsChess core (chessCore.ts / chessAI.ts) and serves perft /
// bestMove over line-delimited JSON. This file belongs to the harness, not the
// engine; the engine itself stays zero-dependency and cordis-unaware.
//
// NOTE on layout: this driver imports the engine core via a relative path that,
// after tsc emits to drivers/ts/out with rootDir=., resolves INSIDE out/
// (so the compiled engine core ships next to the driver). See tsconfig.json.
// =============================================================================

import { GameState, Move, Rules } from '../../../TsChess/chessCore';
import { AIEngine } from '../../../TsChess/chessAI';

// FEN -> GameState (full castling/ep/halfmove/fullmove support).
function setupFromFen(fen: string): GameState {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  const side = parts[1] ?? 'w';
  const castling = parts[2] ?? '-';
  const ep = parts[3] ?? '-';
  const halfmove = parts[4] !== undefined ? parseInt(parts[4], 10) : 0;
  const fullmove = parts[5] !== undefined ? parseInt(parts[5], 10) : 1;

  // NOTE: the TS engine's GameState() constructor calls ResetToStartPosition(),
  // so the board is pre-filled with the start position. We MUST blank it before
  // applying the FEN, otherwise phantom start-position pieces linger on squares
  // the FEN leaves empty — corrupting move generation (e.g. rooks/kings get
  // blocked on Kiwipete). F#/C#/Java/Py clear empties or start blank; TS needs
  // this explicit reset.
  const s = new GameState();
  s.board = Array.from({ length: 8 }, () => Array<string>(8).fill('.'));
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') c += Number(ch);
      else { s.board[r][c] = ch; c++; }
    }
  }
  s.whiteToMove = side === 'w';
  s.canCastleWK = castling.includes('K');
  s.canCastleWQ = castling.includes('Q');
  s.canCastleBK = castling.includes('k');
  s.canCastleBQ = castling.includes('q');
  s.enPassantRow = -1;
  s.enPassantCol = -1;
  if (ep !== '-' && ep.length === 2) {
    s.enPassantCol = ep.charCodeAt(0) - 97; // 'a'
    s.enPassantRow = 8 - Number(ep[1]);
  }
  s.halfmoveClock = halfmove;
  s.fullmoveNumber = fullmove;
  return s;
}

function perft(state: GameState, depth: number): number {
  if (depth === 0) return 1;
  const moves = Rules.GenerateAllLegalMoves(state);
  if (depth === 1) return moves.length;
  let count = 0;
  for (const m of moves) {
    const child = new GameState();
    child.board = state.board.map((row) => row.slice());
    child.whiteToMove = state.whiteToMove;
    child.canCastleWK = state.canCastleWK; child.canCastleWQ = state.canCastleWQ;
    child.canCastleBK = state.canCastleBK; child.canCastleBQ = state.canCastleBQ;
    child.enPassantRow = state.enPassantRow; child.enPassantCol = state.enPassantCol;
    child.halfmoveClock = state.halfmoveClock; child.fullmoveNumber = state.fullmoveNumber;
    Rules.ApplyMove(child, m, false);
    count += perft(child, depth - 1);
  }
  return count;
}

function moveToUci(mv: Move): string {
  const files = 'abcdefgh';
  const from = files[mv.fromCol] + (8 - mv.fromRow);
  const to = files[mv.toCol] + (8 - mv.toRow);
  let uci = from + to;
  if (mv.promotion && mv.promotion !== '.') uci += String(mv.promotion).toLowerCase();
  return uci;
}

function main() {
  process.stdout.write(JSON.stringify({ ready: true }) + '\n');
  const rl = require('readline').createInterface({ input: process.stdin });
  rl.on('line', (line: string) => {
    line = line.trim();
    if (!line) return;
    let req: any;
    try { req = JSON.parse(line); } catch { return; }
    const cmd = req.cmd;
    const fen = req.fen ?? '';
    const depth = Number(req.depth ?? 0);
    const rid = req.id ?? '';
    // Tier 2-B：可选的每步时间预算（毫秒）。缺省/0 ⇒ 走原来的固定深度搜索。
    const timeMs = Number.isFinite(Number(req.timeMs)) ? Number(req.timeMs) : 0;
    try {
      const state = setupFromFen(fen);
      if (cmd === 'perft') {
        process.stdout.write(JSON.stringify({ id: rid, ok: true, nodes: perft(state, depth) }) + '\n');
      } else if (cmd === 'legalMoves') {
        process.stdout.write(JSON.stringify({ id: rid, ok: true, moves: Rules.GenerateAllLegalMoves(state).length }) + '\n');
      } else if (cmd === 'bestMove') {
        // 重复惩罚：用 runner 传入的历史局面键（engine.mjs 兼容键）构建计数表，
        // 赋给 state.repHistory。空/absent ⇒ 不施加惩罚。
        const history: string[] | undefined = req.history;
        if (history && history.length > 0) {
          const rep: { [key: string]: number } = {};
          for (const k of history) rep[k] = (rep[k] ?? 0) + 1;
          state.repHistory = rep;
        }
        const mv = AIEngine.FindBestMove(state, depth > 0 ? depth : 2, timeMs);
        process.stdout.write(JSON.stringify({ id: rid, ok: true, move: mv ? moveToUci(mv) : null, score: 0 }) + '\n');
      } else if (cmd === 'positionKey') {
        // 只读校验辅助：返回请求 FEN 的 engine.mjs 兼容局面键。
        process.stdout.write(JSON.stringify({ id: rid, ok: true, key: state.PositionKeySimple() }) + '\n');
      } else if (cmd === 'evalProfile') {
        // 只读校验辅助：返回本引擎的 Tier 2-C 评估风格档名与 djb2-32 哈希
        // （与验收门 validate_eval_profile.mjs 同一算法）。
        process.stdout.write(JSON.stringify({ id: rid, ok: true, profile: AIEngine.ProfileName, hash: AIEngine.ProfileHash }) + '\n');
      } else {
        process.stdout.write(JSON.stringify({ id: rid, ok: false, error: 'unknown cmd' }) + '\n');
      }
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ id: rid, ok: false, error: String(e?.message ?? e) }) + '\n');
    }
  });
}

main();
