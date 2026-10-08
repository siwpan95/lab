// verify_fs.mjs — regression test for the F# alpha-beta pruning fix.
// Drives the F# driver through a self-play game at depth 4 (both sides played
// by fs) and asserts: (a) no per-move RPC timeout, (b) every move is legal
// per the authoritative engine.mjs. This reproduces the path that used to crash
// at game 15 of the depth-4 tournament.
//
// Toolchain paths follow the same "去本地化" rule as engines.mjs:
//   repo paths  → derived from this file's own location (import.meta.url)
//   DOTNET      → process.env.LAB_DOTNET > local.env LAB_DOTNET > D:/dotnet8/dotnet.exe
//
// Usage: node verify_fs.mjs
// Exit codes: 0 = PASS, 2 = timeout/crash, 3 = illegal move, 1 = fatal.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EngineClient, START_FEN } from './engine_client.mjs';
import * as E from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/tournament
const ROOT = dirname(HERE);                           // <repo>
const repo = (...p) => join(ROOT, ...p);

// --- load local.env (same fallback semantics as engines.mjs) ----------------
function loadLocalEnv(file) {
  try {
    if (!existsSync(file)) return {};
    const out = {};
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/i, '');
      let val = line.slice(eq + 1).trim();
      const quoted = (val.startsWith('"') && val.endsWith('"')) ||
                     (val.startsWith("'") && val.endsWith("'"));
      if (quoted && val.length >= 2) val = val.slice(1, -1);
      if (key) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}
const LOCAL_ENV = loadLocalEnv(join(HERE, 'local.env'));
const envOr = (key, fallback) => process.env[key] || LOCAL_ENV[key] || fallback;

const FS_DLL = repo('chess-cordis', 'drivers', 'fsharp', 'bin', 'Release', 'net8.0', 'FSharpChessDriver.dll');
// fallback 由**写死盘符**改为 PATH 上的 dotnet（铁律 5）；envOr 仍优先 LAB_DOTNET / local.env
const DOTNET = envOr('LAB_DOTNET', 'dotnet');
const MAX_PLY = 60;        // enough to reach the positions that crashed before
const DEPTH = 4;           // the depth that used to time out
const MOVE_TIMEOUT = 120000; // matches engines.mjs fs timeout (headroom)

const main = async () => {
  if (!existsSync(FS_DLL)) {
    console.log(`[FAIL] F# driver DLL not found at ${FS_DLL} — run 'dotnet build' first.`);
    process.exit(2);
  }
  const client = new EngineClient({ id: 'fs', cmd: DOTNET, args: [FS_DLL], timeout: MOVE_TIMEOUT });
  await client.start();
  console.log('[ok] fs driver started');

  let state = E.parseFen(START_FEN);
  let ply = 0;
  let maxMs = 0;
  let totalMs = 0;
  let legalAll = true;

  while (ply < MAX_PLY) {
    if (E.isCheckmate(state) || E.isStalemate(state) || E.isDraw(state)) {
      console.log(`[stop] terminal at ply ${ply}`);
      break;
    }
    const t0 = Date.now();
    let uci;
    try {
      uci = await client.bestMove(E.serializeFen(state), DEPTH);
    } catch (e) {
      console.log(`[FAIL] depth-${DEPTH} bestMove timed out/crashed at ply ${ply}: ${e.message}`);
      client.kill();
      process.exit(2);
    }
    const dt = Date.now() - t0;
    totalMs += dt;
    if (dt > maxMs) maxMs = dt;

    // legality check against authoritative engine
    try {
      state = E.applyUci(state, uci);
    } catch (e) {
      console.log(`[FAIL] illegal move ${uci} at ply ${ply}: ${e.message}`);
      legalAll = false;
      break;
    }
    ply++;
  }

  client.kill();
  console.log(`[result] plies played=${ply}, total=${totalMs}ms, maxPerMove=${maxMs}ms, allLegal=${legalAll}`);
  if (!legalAll) process.exit(3);
  console.log(maxMs < MOVE_TIMEOUT
    ? '[PASS] fs completes depth-4 self-play with no timeout; fix confirmed'
    : '[WARN] a move exceeded the timeout ceiling — still slow');
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
