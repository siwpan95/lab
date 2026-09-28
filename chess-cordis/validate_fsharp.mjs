// Ad-hoc validation for the F# engine: drive it over the JSON-stdio protocol
// and compare perft node counts + bestMove UCI against known ground truth.
import { spawn } from 'node:child_process';

const CMD = 'F:/dotnet/dotnet.exe';
const ARGS = ['E:/lab/FSharpChess/bin/Release/net8.0/FSharpChess.dll'];

const PERFT = [
  ['Start d3', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 8902],
  ['Start d4', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
  ['Kiwipete d2', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
  ['Kiwipete d3', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['Wiki3 d3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3, 2812],
  ['Wiki3 d4', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['Wiki5 d3', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];

const BEST = [
  ['FreeQueen', '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', 3, 'd1d5'],
  ['FreeRook', '4k3/8/8/8/3r4/8/8/3RK3 w - - 0 1', 3, 'd1d4'],
];

function run() {
  return new Promise((resolve) => {
    const proc = spawn(CMD, ARGS, { stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    let ready = false;
    let pending = new Map();
    let counter = 0;
    let pass = 0, fail = 0;

    function rpc(cmd, payload, cb) {
      const uid = `t-${++counter}`;
      pending.set(uid, cb);
      proc.stdin.write(JSON.stringify({ id: uid, cmd, ...payload }) + '\n');
    }
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.ready === true) { ready = true; return; }
        const cb = pending.get(msg.id);
        if (cb) { pending.delete(msg.id); cb(msg); }
      }
    });
    proc.on('exit', () => resolve({ pass, fail }));

    // wait for ready then run tests
    const t0 = setInterval(() => {
      if (!ready) return;
      clearInterval(t0);
      for (const [name, fen, depth, exp] of PERFT) {
        rpc('perft', { fen, depth }, (m) => {
          const ok = m.ok && m.nodes === exp;
          console.log(`[${ok ? 'PASS' : 'FAIL'}] perft ${name}: got=${m.ok ? m.nodes : 'ERR'} expected=${exp}`);
          ok ? pass++ : fail++;
        });
      }
      for (const [name, fen, depth, exp] of BEST) {
        rpc('bestMove', { fen, depth }, (m) => {
          const ok = m.ok && m.move === exp;
          console.log(`[${ok ? 'PASS' : 'FAIL'}] bestMove ${name}: got=${m.ok ? m.move : 'ERR'} expected=${exp}`);
          ok ? pass++ : fail++;
        });
      }
      // give the last RPCs time, then close
      setTimeout(() => proc.kill(), 12000);
    }, 50);
  });
}

const r = await run();
console.log(`\nRESULT: ${r.pass} passed, ${r.fail} failed`);
process.exit(r.fail === 0 ? 0 : 1);
