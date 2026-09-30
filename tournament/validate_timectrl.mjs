// tournament/validate_timectrl.mjs — Tier 2-B（时间控制）验收门。
//
// 对每个支持 timeMs 的引擎断言三件事：
//   1. 等价性（无回归）：预算充足时，迭代加深的最后一轮 == 原来的固定深度搜索结果
//      （timeMs=0 路径）。证明 ID 没有改变棋力，且关闭预算时行为与改造前一致。
//   2. 预算遵守：在重局面以远超预算能完成的深度请求，实测耗时必须落在预算 + slack 内，
//      且返回的必须是一次**完整**搜索的合法着法（中断轮作废、回退上一轮）。
//   3. 合法性：全部测试局面的返回着法都能通过权威 engine.mjs 的合法性校验。
//
// 用法：node validate_timectrl.mjs [id ...]   （缺省 = go,js 试点）
import { EngineClient, START_FEN } from './engine_client.mjs';
import { ENGINES } from './engines.mjs';
import * as E from './engine.mjs';

const FENS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // Kiwipete（重局面）
  'r2q1rk1/ppp2ppp/2n1bn2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQR1K1 w - - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];

// 等价性检查用 depth=3：fs 没有走法排序，Kiwipete 在「无预算(timeMs=0)+depth=4」
// 下会超过 RPC 上限（这正是 fs 历史上崩溃的同一类局面），并非引擎缺陷而是用例过重。
// 预算遵守检查仍用 Kiwipete + 高深度（那才是时间控制该生效的场景）。
const DEPTH_CAP = 3;
const TIGHT_BUDGET = 700;   // ms：故意让 Kiwipete 在 depth 8 下必然超限
const TIGHT_DEPTH = 8;
const SLACK = 400;          // 允许的调度/启动抖动
const AMPLE = 30000;        // 充足预算：应能跑满 depth cap

function legal(fen, uci) {
  try { E.applyUci(E.parseFen(fen), uci); return true; } catch { return false; }
}

async function timed(client, fen, depth, timeMs) {
  const t0 = Date.now();
  const mv = await client.bestMove(fen, depth, undefined, timeMs);
  return { mv, ms: Date.now() - t0 };
}

async function checkEngine(id) {
  const cfg = ENGINES.find((e) => e.id === id);
  const client = new EngineClient({ ...cfg, timeout: 120000 });
  await client.start();
  const results = [];
  try {
    // 1) 等价性：timeMs=0（固定深度） vs 充足预算（迭代加深跑满 cap）
    for (const fen of FENS) {
      const fixed = await timed(client, fen, DEPTH_CAP, 0);
      const ample = await timed(client, fen, DEPTH_CAP, AMPLE);
      results.push({
        ok: fixed.mv === ample.mv && legal(fen, ample.mv),
        kind: 'eq',
        detail: `fixed=${fixed.mv} ample=${ample.mv} legal=${legal(fen, ample.mv)}`,
      });
    }
    // 2) 预算遵守：重局面 + 超深请求
    for (const fen of [FENS[1], FENS[2]]) {
      const t = await timed(client, fen, TIGHT_DEPTH, TIGHT_BUDGET);
      const within = t.ms <= TIGHT_BUDGET + SLACK;
      results.push({
        ok: within && legal(fen, t.mv),
        kind: 'budget',
        detail: `ms=${t.ms} (budget=${TIGHT_BUDGET}+slack=${SLACK}) move=${t.mv} legal=${legal(fen, t.mv)}`,
      });
    }
    // 3) 合法性（全部 FEN，带预算）
    for (const fen of FENS) {
      const t = await timed(client, fen, DEPTH_CAP, TIGHT_BUDGET);
      results.push({ ok: legal(fen, t.mv), kind: 'legal', detail: `${fen.slice(0, 24)}… -> ${t.mv}` });
    }
  } finally {
    client.kill();
  }
  return results;
}

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['go', 'js'];
  let fail = 0;
  for (const id of ids) {
    let results;
    try {
      results = await checkEngine(id);
    } catch (e) {
      console.log(`[FAIL] ${id} — ${e.message}`);
      fail++;
      continue;
    }
    const bad = results.filter((r) => !r.ok);
    if (bad.length === 0) {
      console.log(`[PASS] ${id.padEnd(5)} ${results.length}/${results.length} checks ok`);
    } else {
      console.log(`[FAIL] ${id} — ${bad.length} failed:`);
      for (const b of bad) console.log(`         (${b.kind}) ${b.detail}`);
      fail++;
    }
    // 打点：展示关键实测值（即使通过也打印，便于人工核对余量）
    for (const r of results.filter((x) => x.kind === 'budget')) console.log(`         ${r.detail}`);
  }
  console.log(`\nTOTAL engines=${ids.length} fail=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
