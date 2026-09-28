// Cordis host: composes the multi-language chess fleet under one architecture
// via the REAL @cordisjs/plugin-loader, reading config/cordis.yml.
//
// Composition is data-driven (config/cordis.yml). The host:
//   1. creates the Cordis Context (consuming the real `cordis` package — no vendor),
//   2. mounts the real plugin-loader plugin (installs ctx.loader),
//   3. applyManifest() — declaratively mounts every enabled engine (native + subprocess)
//      as a first-class Cordis component,
//   4. mounts the ChessHarness service and runs the cross-engine perft + bestMove validation.
//
// Load order is reactive (Cordis spatial composability): engines register once
// their plugin fiber is active; unloading any engine plugin cleanly deregisters
// it and kills its child process (temporal composability / revertible effects).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'cordis';
import loader from '@cordisjs/plugin-loader';
import { chessRegistry } from './registry.mjs';
import { harnessPlugin } from './harness.mjs';
import { applyManifest } from './loader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow a different manifest (e.g. a subset with some engines disabled) via
// CORDIS_MANIFEST=<path relative to this file>.
const manifestPath = process.env.CORDIS_MANIFEST
  ? path.resolve(__dirname, process.env.CORDIS_MANIFEST)
  : path.join(__dirname, '../config/cordis.yml');

// baseUrl anchors the loader's relative `name` resolution to the chess-cordis root.
const ctx = new Context();
ctx.baseUrl = new URL('../', import.meta.url);
chessRegistry.bindContext(ctx);

async function main() {
  // Install the real loader (provides ctx.loader).
  await ctx.plugin(loader);

  // Declarative composition from cordis.yml.
  const entries = await applyManifest(ctx, manifestPath);
  console.log(`[host] manifest loaded: ${entries.length} engines declared`);

  // Cross-engine validation service.
  await ctx.plugin(harnessPlugin);
  const report = await ctx.chessHarness.run();
  const bmReport = await ctx.chessHarness.runBestMove();
  console.log(ctx.chessHarness.formatReport(report));
  console.log(ctx.chessHarness.formatBestMoveReport());

  const failed =
    report.some((e) => !e.match || e.diverged.length > 0) ||
    (bmReport ? bmReport.some((e) => e.failed) : false);

  await ctx.fiber.dispose();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('host crashed:', err);
  process.exit(2);
});
