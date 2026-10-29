// Regression test for the single-instance report lock (run_tournament.mjs).
//
// Proves three properties with real evidence:
//   T1  clean acquire writes our PID; release removes the file
//   T2  a second acquire is REFUSED while we already hold it (live PID)
//   T3  a STALE lock (dead PID) is reclaimed instead of blocking forever
//   T4  CROSS-PROCESS mutual exclusion: a separate holding process makes this
//       process' acquire fail, and once it releases we can acquire again
//
// The T4 "child" is this very file re-run with `--hold` (child mode runs ONLY
// the hold branch and never falls through to the parent suite).

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acquireLock, releaseLock } from './run_tournament.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS = join(HERE, 'reports');
const LOCK = join(REPORTS, '.run_lock');
const MARKER = join(REPORTS, '.locktest_child');
const NODE = process.execPath;
const MY_PID = String(process.pid);

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};
const clear = (p) => { try { rmSync(p, { force: true }); } catch {} };

async function runParent() {
  mkdirSync(REPORTS, { recursive: true });
  clear(LOCK);

  console.log('T1 clean acquire / release');
  ok(acquireLock() === true, 'acquireLock returns true on a clean slate');
  ok(existsSync(LOCK) && readFileSync(LOCK, 'utf8').trim() === MY_PID, 'lock file contains our PID');
  releaseLock();
  ok(!existsSync(LOCK), 'releaseLock removes the lock file');

  console.log('T2 live-holder refusal (same process, PID alive)');
  ok(acquireLock() === true, 'acquire');
  ok(acquireLock() === false, 'second acquire refused while we still hold it');
  releaseLock();

  console.log('T3 stale-lock reclaim (dead PID)');
  clear(LOCK);
  writeFileSync(LOCK, '999999', 'utf8'); // PID that is (essentially) never alive
  ok(acquireLock() === true, 'stale lock with dead PID is reclaimed');
  ok(existsSync(LOCK) && readFileSync(LOCK, 'utf8').trim() === MY_PID, 'reclaimed lock now holds our PID');
  releaseLock();

  console.log('T4 cross-process mutual exclusion');
  clear(LOCK); clear(MARKER);
  const child = spawn(NODE, [fileURLToPath(import.meta.url), '--hold'], { stdio: 'ignore' });
  let waited = 0;
  while (!existsSync(MARKER) && waited < 6000) { await new Promise(r => setTimeout(r, 100)); waited += 100; }
  const childState = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : 'none';
  ok(childState === 'held', `child process acquired the lock (state=${childState})`);
  if (childState === 'held') {
    ok(acquireLock() === false, 'parent acquire REFUSED while child holds it');
  }
  await new Promise(r => setTimeout(r, 2900)); // child releases at ~2500ms
  clear(MARKER);
  ok(acquireLock() === true, 'parent acquires after child releases');
  releaseLock();
  try { child.kill(); } catch {}

  clear(LOCK); clear(MARKER);
  console.log(`\nTOTAL pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes('--hold')) {
  // Child mode: hold the lock, signal via MARKER, release after a while. Never
  // fall through to the parent suite.
  mkdirSync(REPORTS, { recursive: true });
  const got = acquireLock();
  writeFileSync(MARKER, got ? 'held' : 'refused', 'utf8');
  if (got) setTimeout(() => { releaseLock(); process.exit(0); }, 2500);
  else process.exit(0);
} else {
  await runParent();
}
