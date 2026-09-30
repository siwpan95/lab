// tournament/measure_engine_timing.mjs — 各引擎 depth=4 单步耗时基线 + 时间预算影响测量。
//
// 对每个引擎、每个局面分别以「无预算(timeMs=0)」与「本引擎预算(ENGINE_TIME_MS)」
// 各求一次最佳着法，报告两者耗时与着法是否一致。用于验证：
//   (1) 每引擎预算在常规局面下**不触发**（耗时与无预算相当、着法完全相同 → 不改变棋力）；
//   (2) 病态长考被优雅截断（典型是 fs 的 Kiwipete：129s → 预算内中断，不超时判负）。
//
// 用法：node measure_engine_timing.mjs [id ...]   （缺省 = engines.mjs 中全部启用引擎）
import { EngineClient, START_FEN } from './engine_client.mjs';
import { ENGINES, timeBudgetFor } from './engines.mjs';

const DEPTH = 4; // 赛事用的深度
const FENS = [
  ['start', START_FEN],
  ['middlegame', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1'],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'],
];

async function main() {
  const ids = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ENGINES.filter((e) => e.enabled).map((e) => e.id);

  for (const id of ids) {
    const cfg = ENGINES.find((e) => e.id === id);
    const budget = timeBudgetFor(id);
    const client = new EngineClient({ ...cfg, timeout: cfg.timeout || 60000 });
    console.log(`\n--- ${id} (budget=${budget}ms, rpcTimeout=${cfg.timeout || 60000}ms) ---`);
    try {
      await client.start();
      for (const [name, fen] of FENS) {
        try {
          let t0 = Date.now();
          const mv0 = await client.bestMove(fen, DEPTH, undefined, 0);
          const ms0 = Date.now() - t0;
          t0 = Date.now();
          const mv1 = await client.bestMove(fen, DEPTH, undefined, budget);
          const ms1 = Date.now() - t0;
          const same = mv0 === mv1 ? 'same' : `DIFF(${mv0} vs ${mv1})`;
          // 只有「无预算那次确实超过了预算」才算真的被截断；
          // 单纯第二次更快是 JIT/缓存预热噪声，不算。
          const capped = (budget > 0 && ms0 > budget && ms1 <= budget * 1.15)
            ? '  <-- 被预算截断（原本会超时判负）' : '';
          console.log(`  ${name.padEnd(11)} noBudget=${String(ms0 + 'ms').padStart(8)}  budgeted=${String(ms1 + 'ms').padStart(8)}  move=${same}${capped}`);
        } catch (e) {
          // 单个局面失败不中断其余测量（典型：无预算跑病态局面超过 RPC 上限）
          console.log(`  ${name.padEnd(11)} ERROR: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    } finally {
      client.kill();
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
