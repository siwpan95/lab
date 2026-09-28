// Dynamic hot-swap temporal-axis stress test.
//
// Validates the Cordis temporal-composability guarantee for the chess fleet:
// an engine can be torn down (its loader entry set `disabled`) at any time
// without disturbing the others, and re-mounted afterwards — all without
// restarting the host process. For a subprocess engine this also proves the
// child OS process is actually killed (not leaked) on teardown.
//
// Run: node src/stress.js   (exit 0 = all phases pass)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'cordis';
import loader from '@cordisjs/plugin-loader';
import { chessRegistry } from './registry.mjs';
import { applyManifest } from './loader.mjs';
import { GOLDEN_POSITIONS } from './harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.join(__dirname, '../config/cordis.yml');

const ctx = new Context();
ctx.baseUrl = new URL('../', import.meta.url);
chessRegistry.bindContext(ctx);

const checks = [];
function record(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}${detail ? '  — ' + detail : ''}`);
}

// Run perft on every currently-registered engine and assert each one matches the
// language-independent golden node count. Returns { pass, info }.
async function perftAllMatch() {
  let pass = true;
  const info = [];
  for (const pos of GOLDEN_POSITIONS) {
    const results = await chessRegistry.runPerft(pos.fen, pos.depth);
    for (const r of results) {
      if (!r.ok || r.nodes !== pos.expected) {
        pass = false;
        info.push(`${pos.name} d${pos.depth}: ${r.id}=${r.ok ? r.nodes : 'ERR'} (exp ${pos.expected})`);
      }
    }
  }
  return { pass, info };
}

async function main() {
  await ctx.plugin(loader);
  await applyManifest(ctx, manifestPath);

  const ids = chessRegistry.list().sort();
  record('baseline: engines loaded via manifest', ids.length > 0, ids.join(','));
  let r = await perftAllMatch();
  record('baseline: every engine matches golden perft', r.pass, r.info.join(' | '));

  // ---- Hot-swap a SUBPROCESS engine (py): teardown + re-mount ----
  const py = chessRegistry.get('py');
  const pyPid = py?.pid;
  await ctx.loader.resolve('py').update({ disabled: true });
  const pyGone = !chessRegistry.has('py');
  const pyDead = py ? !py.alive() : true;
  record('hot-swap py: deregistered AND child process killed', pyGone && pyDead, `pid=${pyPid}`);

  r = await perftAllMatch();
  record('hot-swap py: the other engines keep serving', r.pass, r.info.join(' | '));

  await ctx.loader.resolve('py').update({ disabled: false });
  r = await perftAllMatch();
  record('hot-swap py: re-mounted and matches golden', chessRegistry.has('py') && r.pass, r.info.join(' | '));

  // ---- Hot-swap a NATIVE engine (js): teardown + re-mount ----
  await ctx.loader.resolve('js').update({ disabled: true });
  const jsGone = !chessRegistry.has('js');
  record('hot-swap js: native engine deregistered', jsGone, '');

  r = await perftAllMatch();
  record('hot-swap js: the other engines keep serving', r.pass, r.info.join(' | '));

  await ctx.loader.resolve('js').update({ disabled: false });
  r = await perftAllMatch();
  record('hot-swap js: re-mounted and matches golden', chessRegistry.has('js') && r.pass, r.info.join(' | '));

  const allPass = checks.every((c) => c.pass);
  console.log('---');
  console.log(allPass ? 'STRESS TEST: ALL PHASES PASS (temporal composability verified)' : 'STRESS TEST: FAILURES DETECTED');
  await ctx.fiber.dispose();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('stress test crashed:', err);
  process.exit(2);
});
