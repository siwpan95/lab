import { spawn } from 'node:child_process';
import { parseFen, getPositionKey, applyUci } from './engine.mjs';

const GO = 'D:/projects/lab/chess-cordis/drivers/go/gochess_driver.exe';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const child = spawn(GO, [], { stdio: ['pipe', 'pipe', 'inherit'] });
child.stdin.setDefaultEncoding('utf8');
let buf = '';
const waiters = new Map();
let seq = 0;
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id);
      clearTimeout(w.timer);
      waiters.delete(m.id);
      w.resolve(m);
    }
  }
});
function req(r, t = 60000) {
  const id = `h${seq++}`;
  r.id = id;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { waiters.delete(id); rej(new Error('timeout ' + JSON.stringify(r))); }, t);
    waiters.set(id, { resolve: res, reject: rej, timer });
    child.stdin.write(JSON.stringify(r) + '\n');
  });
}
await new Promise((res) => {
  const ond = (d) => { if (d.toString().includes('ready')) { child.stdout.removeListener('data', ond); res(); } };
  child.stdout.on('data', ond);
  setTimeout(res, 30000);
});

const m0 = await req({ cmd: 'bestMove', fen: START, depth: 1 });
console.log('m0 =', m0.move);
const childState = parseFen(START);
applyUci(childState, m0.move);
const childKey = getPositionKey(childState);
console.log('childKey =', childKey);
const m1a = await req({ cmd: 'bestMove', fen: START, depth: 1, history: [childKey] });
console.log('m1a (1 elem) =', m1a.move);
const m1b = await req({ cmd: 'bestMove', fen: START, depth: 1, history: [childKey, childKey] });
console.log('m1b (2 elem) =', m1b.move);
child.kill('SIGKILL');
