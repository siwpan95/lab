// tournament/probe.mjs
// Spawn each declared engine, ask for one bestMove on the start position, and
// report which drivers actually respond. Used to validate the manifest before
// running the full tournament.
import { EngineClient } from './engine_client.mjs';
import { ENGINES, START_FEN } from './engines.mjs';

async function probeOne(cfg) {
  const client = new EngineClient(cfg);
  try {
    await client.start();
    const t0 = Date.now();
    const move = await client.bestMove(START_FEN, 2);
    const ms = Date.now() - t0;
    client.kill();
    return { id: cfg.id, language: cfg.language, ok: true, move, ms };
  } catch (e) {
    client.kill();
    return { id: cfg.id, language: cfg.language, ok: false, error: String(e.message || e) };
  }
}

const results = [];
for (const cfg of ENGINES) {
  if (cfg.enabled === false) {
    console.log(`skip ${cfg.id} (${cfg.language}) — disabled: ${cfg.disabledReason}`);
    results.push({ id: cfg.id, language: cfg.language, ok: false, disabled: true, error: cfg.disabledReason });
    continue;
  }
  process.stdout.write(`probing ${cfg.id} (${cfg.language}) ... `);
  const r = await probeOne(cfg);
  if (r.ok) console.log(`OK  move=${r.move}  (${r.ms}ms)`);
  else console.log(`FAIL  ${r.error}`);
  results.push(r);
}
console.log('\n=== summary ===');
const ok = results.filter((r) => r.ok).map((r) => r.id);
const bad = results.filter((r) => !r.ok).map((r) => `${r.id}(${r.error})`);
console.log(`available: ${ok.join(', ') || '(none)'}`);
console.log(`unavailable: ${bad.join(', ') || '(none)'}`);
