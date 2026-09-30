// tournament/engine_client.mjs
// A minimal JSON-stdio client for the chess-cordis engine drivers. It speaks the
// same line-delimited JSON protocol the Cordis harness uses: a driver prints
// {"ready":true} on startup, then answers {"id","cmd","fen","depth"} requests
// with a JSON line carrying the same id.
//
// This is intentionally independent of the Cordis framework so the tournament
// runner is self-contained and does not rely on the (currently stale) cordis.yml.

import { spawn } from 'node:child_process';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class EngineClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.ready = false;
    this.started = false;
    this.dead = false;
    this.proc = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const spawnTimeout = setTimeout(() => reject(new Error(`spawn timeout: ${this.cfg.id}`)), this.cfg.spawnTimeout || 30000);
      try {
        this.proc = spawn(this.cfg.cmd, this.cfg.args || [], {
          cwd: this.cfg.cwd || undefined,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (e) {
        clearTimeout(spawnTimeout);
        return reject(e);
      }
      this.started = true;
      this.proc.on('error', (e) => {
        clearTimeout(spawnTimeout);
        this.dead = true;
        reject(e);
      });
      this.proc.on('exit', (code) => { this.dead = true; });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { this.ready = true; continue; }
          const cb = this.pending.get(String(msg.id));
          if (cb) { this.pending.delete(String(msg.id)); cb(msg); }
        }
      });
      this.proc.stderr.on('data', () => {});
      // Resolve once the driver reports ready; fall back after a grace period
      // so a driver that forgets the ready line still works.
      const iv = setInterval(() => {
        if (this.ready) { clearTimeout(spawnTimeout); clearInterval(iv); resolve(this); }
      }, 50);
      setTimeout(() => {
        if (!this.ready) { clearInterval(iv); clearTimeout(spawnTimeout); resolve(this); }
      }, 4000);
    });
  }

  rpc(cmd, fen, depth, history, timeMs) {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error(`${this.cfg.id} is not running`));
      const rid = String(++this.seq);
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error(`rpc timeout (${cmd}, ${this.cfg.id})`));
      }, this.cfg.timeout || 60000);
      this.pending.set(rid, (msg) => { clearTimeout(timer); resolve(msg); });
      try {
        // timeMs: Tier 2-B optional per-move budget; undefined/0 ⇒ engines do a
        // fixed-depth search (identical to pre-Tier-2-B behaviour).
        this.proc.stdin.write(JSON.stringify({ id: rid, cmd, fen, depth, history, timeMs }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(rid);
        reject(e);
      }
    });
  }

  async bestMove(fen, depth, history, timeMs) {
    const r = await this.rpc('bestMove', fen, depth, history, timeMs);
    if (!r.ok) throw new Error(r.error || 'bestMove failed');
    return r.move; // UCI string or null
  }

  kill() {
    this.dead = true;
    try { if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL'); } catch {}
  }
}

export { START_FEN };
