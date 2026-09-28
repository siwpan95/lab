// Real declarative loader for the Cordis chess harness.
//
// Consumes the REAL @cordisjs/plugin-loader (no vendored cordis). The loader is
// mounted as `ctx.loader` (a Cordis service), then `ctx.loader.root.update({...})`
// declaratively instantiates every engine as a first-class Cordis component.
//
// Each entry's `name` is a module path resolved RELATIVE TO `ctx.baseUrl`
// (set to the chess-cordis root in host.js). The loader imports that module and
// calls `ctx.plugin(module, config)`, so our port plugins receive their config
// via the standard Cordis plugin-options channel.
//
//   * kind: native     -> src/ports/js.mjs  (in-process import of JsChess core)
//   * kind: subprocess -> src/ports/subprocess.mjs (spawns a harness driver)
//
// Spatial composability: the *set* of composed engines is pure data (cordis.yml).
// Temporal composability: `ctx.loader.resolve(id).update({disabled:true})`
// disposes that engine's fiber — running its revertible effect, which deregisters
// the engine AND kills its child process. No leaked handles, no orphans.
//
// We deliberately do NOT expose the loader as a per-fiber Cordis Service: a
// Service resolves to a distinct instance per fiber, which broke cross-plugin
// visibility earlier. Instead we bind the enable/disable API onto the already-
// shared chessRegistry singleton (see registry.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { chessRegistry } from './registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Map a manifest entry to a real loader entry ({ id, name, config, disabled }).
// The real @cordisjs/plugin-loader's EntryGroup.update() consumes an ARRAY of
// such option objects, keyed internally by `id`.
function toEntry(id, cfg) {
  const kind = cfg.kind ?? 'subprocess';
  const name = kind === 'native' ? './src/ports/js.mjs' : './src/ports/subprocess.mjs';
  return {
    id,
    name,
    config: { ...cfg, id },
    disabled: cfg.enabled === false,
  };
}

export function manifestToEntries(manifestPath) {
  const text = fs.readFileSync(manifestPath, 'utf8');
  const doc = yaml.load(text);
  const plugins = (doc && doc.plugins) || {};
  const entries = [];
  for (const [id, cfg] of Object.entries(plugins)) {
    entries.push(toEntry(id, cfg || {}));
  }
  return entries;
}

// Apply the manifest: install every engine as a declarative loader entry.
// Requires `ctx.loader` to already exist (mount the @cordisjs/plugin-loader
// plugin before calling this).
export async function applyManifest(ctx, manifestPath = path.join(__dirname, '../config/cordis.yml')) {
  const entries = manifestToEntries(manifestPath);
  await ctx.loader.root.update(entries);

  // Bind the reactive enable/disable API onto the shared singleton so the
  // harness / stress test can mount or tear down a single engine — the
  // temporal-composability axis.
  chessRegistry.bindLoader({
    mountAll: async () => {
      for (const e of entries) {
        if (!e.disabled) await ctx.loader.resolve(e.id).update({ disabled: false });
      }
    },
    mount: async (id) => ctx.loader.resolve(id).update({ disabled: false }),
    unmount: async (id) => ctx.loader.resolve(id).update({ disabled: true }),
    list: () => chessRegistry.list(),
    isMounted: (id) => chessRegistry.has(id),
  });

  return entries;
}
