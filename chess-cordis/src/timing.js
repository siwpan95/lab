// Cordis timing harness — measures per-engine perft throughput across the whole
// fleet and prints a cross-language timing table.
//
// Reuses the SAME Cordis bootstrap as host.js: real cordis + real loader, driven
// by config/cordis.yml. Each enabled engine is loaded as a first-class component;
// we then drive perft on fixed (position, depth) pairs and time the wall-clock
// cost (which includes the JSON-stdio RPC for out-of-process engines — i.e. the
// real harness-level cost, not just raw engine compute).
//
// Usage: node src/timing.js   (optional: CORDIS_MANIFEST=<rel path>)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'cordis';
import loader from '@cordisjs/plugin-loader';
import { chessRegistry } from './registry.mjs';
import { applyManifest } from './loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.env.CORDIS_MANIFEST
  ? path.resolve(__dirname, process.env.CORDIS_MANIFEST)
  : path.join(__dirname, '../config/cordis.yml');

const BENCHMARKS = [
  { name: 'Start d4', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 4 },
  { name: 'Kiwipete d4', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 4 },
];

const ITER = 3; // timed iterations per engine/benchmark (after 1 warmup)

const ctx = new Context();
ctx.baseUrl = new URL('../', import.meta.url);
chessRegistry.bindContext(ctx);

async function timeEngine(e, fen, depth) {
  // warmup (covers first-call / lazy init)
  await e.perft(fen, depth);
  let total = 0;
  let nodes = 0;
  for (let i = 0; i < ITER; i++) {
    const t0 = Date.now();
    nodes = await e.perft(fen, depth);
    total += Date.now() - t0;
  }
  const avgMs = total / ITER;
  const mnps = nodes / (avgMs / 1000) / 1e6;
  return { nodes, avgMs, mnps };
}

async function main() {
  await ctx.plugin(loader);
  const entries = await applyManifest(ctx, manifestPath);
  const ids = chessRegistry.list();
  console.log(`[timing] manifest loaded: ${entries.length} engines; timing ${ids.length} enabled engines`);

  const tables = [];
  for (const bm of BENCHMARKS) {
    const rows = [];
    for (const id of ids) {
      const e = chessRegistry.get(id);
      if (typeof e?.perft !== 'function') {
        rows.push({ id, lang: e?.language ?? '?', nodes: 0, avgMs: NaN, mnps: 0, err: 'no perft' });
        continue;
      }
      try {
        const { nodes, avgMs, mnps } = await timeEngine(e, bm.fen, bm.depth);
        rows.push({ id, lang: e.language, nodes, avgMs, mnps });
      } catch (err) {
        rows.push({ id, lang: e?.language ?? '?', nodes: 0, avgMs: NaN, mnps: 0, err: String(err?.message ?? err) });
      }
    }
    rows.sort((a, b) => a.avgMs - b.avgMs);
    tables.push({ bm, rows });
  }

  // Render markdown tables
  for (const { bm, rows } of tables) {
    console.log('');
    console.log(`### ${bm.name} (depth ${bm.depth})`);
    console.log('');
    console.log('| engine | language | nodes | avg ms | Mnodes/s |');
    console.log('|---|---|---|---|---|');
    for (const r of rows) {
      const ms = Number.isFinite(r.avgMs) ? r.avgMs.toFixed(1) : 'ERR';
      const m = Number.isFinite(r.mnps) ? r.mnps.toFixed(2) : '-';
      const note = r.err ? ` (${r.err})` : '';
      console.log(`| ${r.id} | ${r.lang} | ${r.nodes} | ${ms} | ${m} |${note ? ` ${note}` : ''}`);
    }
  }

  await ctx.fiber.dispose();
  process.exit(0);
}

main().catch((err) => {
  console.error('timing crashed:', err);
  process.exit(2);
});
