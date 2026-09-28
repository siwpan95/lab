// Spawn a single subprocess engine, ask for bestMove on FreeQueen, print raw reply.
import { spawn } from 'node:child_process';

const [cmd, ...args] = process.argv.slice(2);
const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
let pending = null;
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.ready === true) { send(); continue; }
    if (pending) { const p = pending; pending = null; p(m); }
  }
});
proc.on('error', (e) => { console.error('spawn error', e.message); process.exit(3); });

const FEN = '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1';
function send() {
  const uid = 'q1';
  pending = (msg) => { console.log(cmd.split(/[\\/]/).pop(), '=>', JSON.stringify(msg)); proc.kill(); process.exit(0); };
  proc.stdin.write(JSON.stringify({ id: uid, cmd: 'bestMove', fen: FEN, depth: 3 }) + '\n');
}
setTimeout(() => { console.error('timeout'); proc.kill(); process.exit(2); }, 8000);
