// tournament/divergence_probe.mjs — Tier 2-C 走法分歧率探针。
// 对全部 10 个引擎，在若干 FEN 上求 depth=3 首选着法，统计两两一致的比率。
// Tier 2-C 之前（10 引擎同 eval）各引擎在同 FEN 几乎 100% 同着；
// 差异化 profile 落地后分歧率应显著上升 —— 这是「对局多样性」的直接证据。
// 用法：node divergence_probe.mjs [id ...]   （缺省 = engines.mjs 中全部启用引擎）
import { EngineClient, START_FEN } from './engine_client.mjs';
import { ENGINES } from './engines.mjs';

const DEPTH = 3; // 探针用 depth=3：10 引擎 × 多 FEN 保持分钟级完成（py/fs 慢）

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

async function main() {
  const ids = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ENGINES.filter((e) => e.enabled).map((e) => e.id);
  const clients = new Map();
  for (const id of ids) {
    const cfg = ENGINES.find((e) => e.id === id);
    const c = new EngineClient({ ...cfg, timeout: 180000 });
    await c.start();
    clients.set(id, c);
  }

  // moves[id][fenIndex] = UCI or null
  const moves = {};
  for (const id of ids) moves[id] = [];
  for (let fi = 0; fi < FENS.length; fi++) {
    for (const id of ids) {
      moves[id][fi] = await clients.get(id).bestMove(FENS[fi], DEPTH, undefined);
    }
  }

  // 两两一致率 + 引擎级「与所有引擎的分歧 FEN 数」
  let same = 0, total = 0;
  const disagreeCount = {};
  for (const id of ids) disagreeCount[id] = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let fi = 0; fi < FENS.length; fi++) {
        total++;
        if (moves[ids[i]][fi] === moves[ids[j]][fi]) same++;
        else { disagreeCount[ids[i]]++; disagreeCount[ids[j]]++; }
      }
    }
  }

  console.log('--- per-FEN 首选着 ---');
  for (let fi = 0; fi < FENS.length; fi++) {
    const line = ids.map((id) => `${id}=${String(moves[id][fi]).padEnd(5)}`).join('  ');
    console.log(`[F${fi + 1}] ${line}`);
  }
  console.log('--- 引擎分歧热度（与其他引擎在同 FEN 上首选着不同的次数）---');
  for (const id of ids) console.log(`  ${id.padEnd(5)} disagree=${disagreeCount[id]}/${(ids.length - 1) * FENS.length}`);
  const agreeRate = (100 * same / total).toFixed(1);
  console.log(`\n两两(FEN,引擎对)同着率: ${same}/${total} = ${agreeRate}%  →  分歧率 ${(100 - agreeRate).toFixed(1)}%`);

  for (const c of clients.values()) c.kill();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
