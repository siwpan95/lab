// validate_maxply.mjs —— MAX_PLY 收尾裁决（adjudication）回归测试
//
// 背景（board-replay 独立复盘发现）：runner 打到 MAX_PLY 退出 ply 循环后直接落
// 「max-ply 和棋」，没有再判一次终局。若最后一手正好将死，这局就被错记成和棋。
// 实例：reports/2026-09-30__TC_on_3000ms.md 的 js(白)-cpp(黑) 第 1 局，160 手，
//       末手 g5e5 实为将死（黑/cpp 胜），战报却写「和棋（max-ply (160) reached）」。
//
// 修复：把终局/和棋判定抽成 adjudicate()，ply 循环退出后再调用一次。
// 本脚本验证：
//   T1 adjudicate() 对四类局面裁决正确（未终局 / 将死 / 逼和 / 三轮重复）
//   T2 真实历史局重放：上面那局现在应裁决为 checkmate、cpp 胜（而不再是和棋）
//   T3 端到端：ply 上限=7 且第 7 手将死 → 裁决 checkmate 胜（新路径，修复前会是 max-ply 和）
//   T4 端到端：ply 上限=6（第 6 手后未终局）→ 仍是 max-ply 和（回归，不得误判）
//   T5 影响面量化：扫描历史战报里所有 max-ply 局，列出会被新逻辑改判的局
//
// T3/T4 需要不同的 TOURNAMENT_MAX_PLY，而 PLY_CAP 在模块加载时读取，
// 故这两个用例以子进程（带 env）方式重入本脚本。
//
// 用法：node validate_maxply.mjs [--case t1|t2|t3|t4|t5]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as E from './engine.mjs';
import { adjudicate, playGame } from './run_tournament.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`[maxply] PASS ${name}`); pass++; } else {
    console.log(`[maxply] FAIL ${name}${extra ? ' :: ' + extra : ''}`);
    fail++;
  }
}

// ---------- T1: adjudicate() 四类局面 ----------
function replay(fen, ucis) {
  let s = E.parseFen(fen);
  for (const u of ucis) s = E.applyUci(s, u);
  return s;
}

function t1() {
  console.log('\n--- T1 adjudicate() 四类局面 ---');
  // 未终局
  check('起始局面 -> null（未终局）', adjudicate(E.parseFen(START_FEN), 'w', 'b', null, [], 0, null) === null);
  // 将死：Scholar's mate 终局（白 h5f7#）
  {
    const s = replay(START_FEN, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    const r = adjudicate(s, 'white', 'black', null, [], 7, null);
    check("将死 -> win/white/checkmate", r && r.result === 'win' && r.winner === 'white' && r.reason === 'checkmate',
      JSON.stringify(r));
    check('将死 -> loser 是被将死方', r && r.loser === 'black', JSON.stringify(r));
  }
  // 逼和：经典 stalemate 局面（黑无合法着且未被将）
  {
    const s = E.parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const r = adjudicate(s, 'w', 'b', null, [], 1, null);
    check('逼和 -> draw/stalemate', r && r.result === 'draw' && r.reason === 'stalemate', JSON.stringify(r));
  }
  // 三轮重复：马来回走 4 步 x2 轮
  {
    const s = replay(START_FEN, ['b1c3', 'b8c6', 'c3b1', 'c6b8', 'b1c3', 'b8c6', 'c3b1', 'c6b8']);
    const r = adjudicate(s, 'w', 'b', null, [], 8, null);
    check('三轮重复 -> draw/threefold', r && r.result === 'draw' && r.reason === 'threefold', JSON.stringify(r));
  }
}

// ---------- 战报解析（供 T2 / T5 复用） ----------
function cleanUci(tok) {
  const m = tok.match(/^[a-h][1-8][a-h][1-8][qrbnQRBN]?/);
  return m ? m[0] : null;
}

// 解析一份战报 -> [{ id, white, black, result, reason, moves }]
function parseReport(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const games = [];
  let pending = null;
  let pair = '';
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('### ')) { pair = t.slice(4); pending = null; continue; }
    if (t.startsWith('**第')) {
      const wm = t.match(/([A-Za-z0-9_]+)\s*执白/);
      const bm = t.match(/([A-Za-z0-9_]+)\s*执黑/);
      const win = t.match(/([A-Za-z0-9_]+)\s*胜\s*([A-Za-z0-9_]+)/);
      const num = (t.match(/第\s*(\d+)\s*局/) || [])[1] || '?';
      // reason：最后一个全角「（」到行尾（兼容内含半角括号的 "max-ply (160) reached"）
      let lo = t.lastIndexOf('（');
      if (lo < 0) lo = t.lastIndexOf('(');
      let reason = '';
      if (lo >= 0) {
        reason = t.slice(lo + 1).trim();
        if (reason.endsWith('）') || reason.endsWith(')')) reason = reason.slice(0, -1);
      }
      pending = {
        num, pair,
        white: wm ? wm[1] : '', black: bm ? bm[1] : '',
        result: win ? 'win' : (/和棋|和局|draw/i.test(t) ? 'draw' : 'other'),
        winner: win ? win[1] : null, loser: win ? win[2] : null,
        reason, moves: [],
      };
      continue;
    }
    if (t.startsWith('> ') && pending) {
      const mv = t.slice(1).trim().split(/\s+/).map(cleanUci).filter(Boolean);
      if (!mv.length) continue;
      pending.moves = mv;
      games.push(pending);
      pending = null;
    }
  }
  return games;
}

// ---------- T2: 真实历史局（曾被错记为 max-ply 和棋的将死局） ----------
function t2() {
  console.log('\n--- T2 真实历史局：js(白) vs cpp(黑) 第 1 局（160 手，末手 g5e5） ---');
  const file = join(REPORTS_DIR, '2026-09-30__TC_on_3000ms.md');
  let games = [];
  try { games = parseReport(file); } catch (e) {
    console.log(`[maxply] SKIP T2（无法读取 ${file}: ${e.message}）`);
    return;
  }
  const g = games.find((x) => x.num === '1' && x.white === 'js' && x.black === 'cpp');
  if (!g) { console.log('[maxply] SKIP T2（战报中未找到 js-cpp 第 1 局）'); return; }
  console.log(`[maxply] 战报声明：${g.result} / ${g.reason}，手数 ${g.moves.length}`);
  if (g.moves.length !== 160) console.log(`[maxply] 注：手数为 ${g.moves.length}（非 160）`);
  const s = replay(START_FEN, g.moves);
  const r = adjudicate(s, g.white, g.black, null, g.moves, g.moves.length, null);
  check('该局在收尾裁决下判为将死', r && r.reason === 'checkmate', JSON.stringify(r));
  check('该局胜方为 cpp（黑）', r && r.winner === 'cpp', JSON.stringify(r));
  check('修复生效：不再落 max-ply 和棋', !(r && String(r.reason).startsWith('max-ply')), JSON.stringify(r));
}

// ---------- T3 / T4: 端到端 playGame（stub 引擎） ----------
function stubClient(id, moves) {
  let i = 0;
  return { cfg: { id }, kill() {}, async bestMove() { return i < moves.length ? moves[i++] : null; } };
}

const SCHOLAR_WHITE = ['e2e4', 'f1c4', 'd1h5', 'h5f7'];
const SCHOLAR_BLACK = ['e7e5', 'b8c6', 'g8f6'];

async function runPlayGame(cap) {
  const w = stubClient('stubW', SCHOLAR_WHITE);
  const b = stubClient('stubB', SCHOLAR_BLACK);
  return playGame(w, b, 1, 'stubW', 'stubB', 1, 0);
}

async function t3() {
  console.log('\n--- T3 端到端：TOURNAMENT_MAX_PLY=7，第 7 手将死（正好用满上限） ---');
  const r = await runPlayGame();
  console.log(`[maxply] playGame -> ${JSON.stringify({ result: r.result, winner: r.winner, reason: r.reason, ply: r.ply })}`);
  check('ply 用满上限 7', r.ply === 7, 'ply=' + r.ply);
  check('裁决为 checkmate 胜（而非 max-ply 和棋）', r.result === 'win' && r.reason === 'checkmate', JSON.stringify(r));
  check('胜方为白（执将死手）', r.winner === 'stubW', JSON.stringify(r));
  check('末手带 # 注解', String(r.moves[r.moves.length - 1]).endsWith('#'), r.moves[r.moves.length - 1]);
}

async function t4() {
  console.log('\n--- T4 端到端：TOURNAMENT_MAX_PLY=6，第 6 手后未终局（回归） ---');
  const r = await runPlayGame();
  console.log(`[maxply] playGame -> ${JSON.stringify({ result: r.result, winner: r.winner, reason: r.reason, ply: r.ply })}`);
  check('ply 用满上限 6', r.ply === 6, 'ply=' + r.ply);
  check('仍判 max-ply 和棋（不得误判）', r.result === 'draw' && String(r.reason).startsWith('max-ply'), JSON.stringify(r));
  // 不变式：记为 max-ply 的局，重放后确实非终局
  const s = replay(START_FEN, r.moves.map(cleanUci).filter(Boolean));
  check('不变式：max-ply 局重放后确实非终局',
    !E.isCheckmate(s) && !E.isStalemate(s) && !E.isDraw(s), E.serializeFen(s));
}

// ---------- T5: 影响面量化（历史战报里会被改判的 max-ply 局） ----------
function t5() {
  console.log('\n--- T5 影响面：历史战报中「max-ply 和棋」但重放实为终局的局 ---');
  let files = [];
  try { files = readdirSync(REPORTS_DIR).filter((f) => f.toLowerCase().endsWith('.md')); } catch { /* none */ }
  let scanned = 0;
  let affected = 0;
  for (const f of files) {
    let games = [];
    try { games = parseReport(join(REPORTS_DIR, f)); } catch { continue; }
    for (const g of games) {
      if (!/max-ply/i.test(g.reason) || !g.moves.length) continue;
      scanned++;
      let s;
      try { s = replay(START_FEN, g.moves); } catch { continue; }
      const r = adjudicate(s, g.white, g.black, null, g.moves, g.moves.length, null);
      if (r) {
        affected++;
        console.log(`  [改判] ${f}｜${g.white}(白) vs ${g.black}(黑) 第 ${g.num} 局｜`
          + `原「和棋/${g.reason}」 -> 新「${r.result === 'win' ? r.winner + ' 胜' : r.reason}」`);
      }
    }
  }
  console.log(`[maxply] 扫描 ${scanned} 个历史 max-ply 局，其中 ${affected} 局会被新逻辑改判（积分/胜负口径会随之变化）`);
  check('T5 完成扫描（不改判任何断言，仅量化影响面）', true);
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args[args.indexOf('--case') + 1] || '').toLowerCase();

  if (!only || only === 't1') t1();
  if (!only || only === 't2') t2();
  if (!only || only === 't5') t5();

  // T3 / T4 需要不同 PLY_CAP -> 子进程重入
  for (const [c, cap] of [['t3', 7], ['t4', 6]]) {
    if (only && only !== c) continue;
    const self = resolve(__dirname, 'validate_maxply.mjs');
    const env = { ...process.env, TOURNAMENT_MAX_PLY: String(cap) };
    const child = spawnSync(process.execPath, [self, '--case', c + 'run'], { env, encoding: 'utf8' });
    const out = child.stdout || '';
    process.stdout.write(out);
    if (child.stderr) process.stderr.write(child.stderr);
    // 汇总子进程的 PASS/FAIL 计数（子进程只跑单个用例，退出码另作兜底）
    pass += (out.match(/\[maxply\] PASS/g) || []).length;
    fail += (out.match(/\[maxply\] FAIL/g) || []).length;
    if (child.status !== 0 && !/\[maxply\] FAIL/.test(out)) fail++; // 子进程崩了但没报 FAIL
  }

  if (only === 't3run') await t3();
  if (only === 't4run') await t4();

  if (only) {
    process.exit(fail ? 1 : 0); // 子进程（单用例）：把结果回传给父进程
  }
  console.log(`\n[maxply] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('[maxply] FATAL', e); process.exit(1); });
