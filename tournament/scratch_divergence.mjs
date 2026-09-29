// tournament/scratch_divergence.mjs — 批1试点用：go vs js 走法分歧率探针。
// 同一 FEN、同 depth=4，各引擎返回 bestMove；统计两者一致的比例。
// Tier 2-C 之前两引擎同 eval → 几乎 100% 一致；profile 生效后应出现显著分歧。
import { EngineClient, START_FEN } from './engine_client.mjs';
import { ENGINES } from './engines.mjs';

const FENS = [
  START_FEN,
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1',
  'r2q1rk1/ppp2ppp/2n1bn2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQR1K1 w - - 0 1',
  'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 1',
  '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
];

const clients = new Map();
for (const id of ['go', 'js']) {
  const cfg = ENGINES.find((e) => e.id === id);
  const c = new EngineClient({ ...cfg, timeout: 60000 });
  await c.start();
  clients.set(id, c);
}

let same = 0, diff = 0;
for (let i = 0; i < FENS.length; i++) {
  const fen = FENS[i];
  const m = {};
  for (const [id, c] of clients) {
    m[id] = await c.bestMove(fen, 4, undefined);
  }
  const tag = m.go === m.js ? 'SAME' : 'DIFF';
  if (m.go === m.js) same++; else diff++;
  console.log(`[${i + 1}/${FENS.length}] ${tag}  go=${m.go}  js=${m.js}`);
}
console.log(`\n分歧率: ${diff}/${FENS.length} = ${(100 * diff / FENS.length).toFixed(0)}%`);
for (const c of clients.values()) c.kill();
