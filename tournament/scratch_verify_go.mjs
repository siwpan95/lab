// scratch_verify_go.mjs — validates the Go repetition-penalty pilot (Tier 2-A).
// 1) parity: go driver `positionKey` must equal engine.mjs getPositionKey() byte-for-byte
// 2) behavioral: with the post-best-move key in history, search avoids it.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFen, getPositionKey, applyUci } from './engine.mjs';

// 路径按脚本位置定位（去符盘，铁律 5）：本文件在 lab/tournament/ 下。
const GO = fileURLToPath(new URL('../chess-cordis/drivers/go/gochess_driver.exe', import.meta.url));
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1',
  'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 1',
  'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
  '8/8/8/3k4/8/3K4/8/8 w - - 0 1',
];

function startDriver() {
  return new Promise((resolve, reject) => {
    const proc = spawn(GO, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let pending = null;
    const onData = (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.ready) { resolve({ proc, rpc }); return; }
        if (pending) { const p = pending; pending = null; p.resolve(msg); }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => process.stderr.write('[go stderr] ' + d));
    proc.on('error', reject);
    function rpc(cmd, fen, depth, history) {
      return new Promise((res) => {
        pending = { resolve: res };
        proc.stdin.write(JSON.stringify({ id: 'x', cmd, fen, depth, history }) + '\n');
      });
    }
  });
}

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};

const drv = await startDriver();

// ---- 1. parity ----
for (const fen of FENS) {
  const r = await drv.rpc('positionKey', fen, 0, null);
  const estate = parseFen(fen);
  const expect = getPositionKey(estate);
  check('go parity ' + fen.slice(0, 22), r.ok && r.key === expect, `\n  go =${r.key}\n  em =${expect}`);
}

// ---- 2. behavioral (depth 1: child is the leaf, penalty applies directly) ----
const m0 = await drv.rpc('bestMove', START, 1, null);
const childState = applyUci(parseFen(START), m0.move);
const childKey = getPositionKey(childState);
const m1 = await drv.rpc('bestMove', START, 1, [childKey]);
console.log(`  behavioral: M0=${m0.move}  M1=${m1.move}  childKey=${childKey.slice(0, 16)}...`);
check('go search avoids repeating best move', m1.move !== m0.move, `M0=${m0.move} M1=${m1.move}`);

drv.proc.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
