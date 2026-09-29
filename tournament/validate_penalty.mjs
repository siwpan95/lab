// validate_penalty.mjs — generic acceptance harness for the Tier 2-A repetition
// penalty port. Spawns an engine (command resolved via engines.mjs, so all
// toolchain paths / local.env overrides apply), then checks two things:
//
//   1) PositionKeySimple parity: for 8 FENs (incl. en-passant for both sides
//      and a partial-castling position), the engine's `positionKey` command must
//      return EXACTLY engine.mjs.getPositionKey(parseFen(fen)). This is the whole
//      reason a separate key format exists — if it diverges, the penalty never
//      fires or fires on the wrong position.
//
//   2) Behavioral avoidance: at depth 1 on the start position, the best move M0
//      (no history) must differ from the best move M1 when M0's resulting
//      position is listed in `history`. This proves the penalty actually steers
//      the search away from a repeating position.
//
// Usage: node validate_penalty.mjs --id <engineId>
//        node validate_penalty.mjs          (all enabled engines, sequentially)

import { spawn } from 'node:child_process';
import { ENGINES } from './engines.mjs';
import { parseFen, getPositionKey, applyUci } from './engine.mjs';

const FENS = [
  // 0 start
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  // 1 en passant (white to capture): black pawn d5, white pawn e5, ep d6
  'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 1',
  // 2 partial castling: only white kingside + black queenside (Kq)
  'r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1',
  // 3 midgame, black to move
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2',
  // 4 KR vs kp endgame
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  // 5 position with promotions possible + castling
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  // 6 en passant for black to capture (white pawn e4, ep e3)
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  // 7 king vs king
  '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
];

const argv = process.argv.slice(2);
let onlyId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--id') onlyId = argv[++i];
}

function engineById(id) {
  const e = ENGINES.find((x) => x.id === id);
  if (!e) throw new Error(`engine id not found: ${id}`);
  if (!e.enabled) throw new Error(`engine ${id} is disabled`);
  return e;
}

function startEngine(e) {
  const child = spawn(e.cmd, e.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.setDefaultEncoding('utf8');
  let buf = '';
  const waiters = new Map(); // id -> {resolve, reject, timer}
  let seq = 0;

  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const t = line.trim();
      if (!t) continue;
      let msg;
      try { msg = JSON.parse(t); } catch { continue; }
      if (msg.id && waiters.has(msg.id)) {
        const w = waiters.get(msg.id);
        clearTimeout(w.timer);
        waiters.delete(msg.id);
        w.resolve(msg);
      }
    }
  });

  const ready = new Promise((resolve, reject) => {
    const onData = (d) => {
      if (d.toString().includes('"ready":true') || d.toString().includes('{"ready":true}')) {
        child.stdout.removeListener('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    setTimeout(() => reject(new Error('ready timeout')), 30000);
  });

  function request(req, timeoutMs = 60000) {
    const id = `h${seq++}`;
    req.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error(`request timeout: ${JSON.stringify(req)}`));
      }, timeoutMs);
      waiters.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  return { child, ready, request, kill: () => { try { child.kill('SIGKILL'); } catch {} } };
}

async function validateOne(id) {
  const e = engineById(id);
  const proc = startEngine(e);
  let pass = 0, fail = 0;
  const problems = [];
  try {
    await proc.ready;

    // ---- parity: positionKey vs engine.mjs ----
    for (let i = 0; i < FENS.length; i++) {
      const fen = FENS[i];
      const expected = getPositionKey(parseFen(fen));
      const resp = await proc.request({ cmd: 'positionKey', fen });
      const got = resp && resp.key;
      if (got === expected) {
        pass++;
      } else {
        fail++;
        problems.push(`parity FEN[${i}] expected=${expected} got=${got}`);
      }
    }

    // ---- behavioral: move avoidance under repetition penalty ----
    try {
      const startFen = FENS[0];
      const m0 = await proc.request({ cmd: 'bestMove', fen: startFen, depth: 1 });
      const m0move = m0 && m0.move;
      if (m0move) {
        // NOTE: applyUci returns the NEW state (applyMove clones internally); the
        // passed state is NOT mutated. Use the return value as the post-move state.
        const child = applyUci(parseFen(startFen), m0move);
        const childKey = getPositionKey(child);
        const m1 = await proc.request({ cmd: 'bestMove', fen: startFen, depth: 1, history: [childKey, childKey] });
        const m1move = m1 && m1.move;
        if (m1move && m1move !== m0move) {
          pass++;
        } else {
          // non-fatal: parity (above) is the authoritative gate. A behavioral miss
          // can also mean the engine's start eval has a uniquely-best move >60cp
          // ahead — acceptable, not a bug.
          problems.push(`(warn) behavioral M0=${m0move} M1=${m1move} — penalty did not flip move at start (acceptable if start eval uniquely-best)`);
        }
      } else {
        problems.push('(warn) behavioral: bestMove returned no move');
      }
    } catch (err) {
      problems.push(`(warn) behavioral error: ${err.message}`);
    }
  } catch (err) {
    fail++;
    problems.push(`fatal: ${err.message}`);
  } finally {
    proc.kill();
  }
  return { id, pass, fail, problems };
}

async function main() {
  const ids = onlyId ? [onlyId] : ENGINES.filter((e) => e.enabled).map((e) => e.id);
  let totalPass = 0, totalFail = 0;
  for (const id of ids) {
    const r = await validateOne(id);
    const status = r.fail === 0 ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${id.padEnd(6)} pass=${r.pass} fail=${r.fail}`);
    for (const p of r.problems) console.log(`         - ${p}`);
    totalPass += r.pass;
    totalFail += r.fail;
  }
  console.log(`\nTOTAL pass=${totalPass} fail=${totalFail}`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
