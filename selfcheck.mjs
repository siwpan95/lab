// lab — 无头自检入口（Node ESM）。
//
// 只用标准库 + 仓内既有模块，不新增任何 npm 依赖：
//   - ./JsChess/chessCore.js          纯规则/走法/AI，无 IO、无 DOM
//   - ./chess-cordis/src/fen.mjs      FEN <-> GameState 适配 + 引擎无关 perft
//
// 验证点：
//   1. FEN 解析/校验：起始局面布局与元数据正确，非法 FEN 响亮报错。
//   2. perft 黄金值（perft_spec.txt 的跨语言契约）：4 个标准位置 d1–d3。
//   3. 走子与状态推进：合法走法生成、ApplyMove 后的棋盘/走子方变化、Clone 深拷贝隔离。
//   4. UCI 记法：Move -> UCI 字符串（含升变后缀）。
//   5. AI 搜索：一步杀找到 Ra8#，白后白吃找到 d1d5，且返回的走法确实合法。
//
// 用法：node selfcheck.mjs   （成功退出 0，失败打印 FAIL 并退出 1）

import { buildGameState, parseFen, perftSync } from './chess-cordis/src/fen.mjs';
import { AIEngine, GameState, Rules } from './JsChess/chessCore.js';

const FAILS = [];
const FILES = 'abcdefgh';

function check(name, fn) {
  try {
    const detail = fn();
    if (detail === false) throw new Error('检查返回 false');
    console.log(`  [ok] ${name}${typeof detail === 'string' ? ` — ${detail}` : ''}`);
  } catch (err) {
    const msg = `${name}: ${err && err.message ? err.message : err}`;
    FAILS.push(msg);
    console.log(`  [FAIL] ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// row 0 = rank 8（与所有引擎的 board[0]=rank8 约定一致）
function toUci(mv) {
  const promo = mv.promotion ?? mv.promo ?? '.';
  let s = FILES[mv.fromCol] + (8 - mv.fromRow) + FILES[mv.toCol] + (8 - mv.toRow);
  if (promo && promo !== '.') s += String(promo).toLowerCase();
  return s;
}

// perft_spec.txt 的黄金值（chessprogramming wiki 标准局面）
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1';

const GOLDEN = [
  ['起始局面', START, [20, 400, 8902]],
  ['Kiwipete', KIWIPETE, [48, 2039, 97862]],
  ['WP-3', POS3, [14, 191, 2812]],
  ['WP-5', POS5, [44, 1486, 62379]],
];

// ═══════════════════════════════════════════════════════════════
//  1. FEN 解析与校验
// ═══════════════════════════════════════════════════════════════
function checkFen() {
  const p = parseFen(START);
  assert(p.board.length === 8, `FEN 应解析出 8 行，实际 ${p.board.length}`);
  for (let r = 0; r < 8; r++) {
    assert(p.board[r].length === 8, `第 ${r} 行应为 8 列，实际 ${p.board[r].length}`);
  }
  assert(p.board[0].join('') === 'rnbqkbnr', `rank8 应为 rnbqkbnr，实际 ${p.board[0].join('')}`);
  assert(p.board[1].join('') === 'pppppppp', 'rank7 应全是黑兵');
  assert(p.board[6].join('') === 'PPPPPPPP', 'rank2 应全是白兵');
  assert(p.board[7].join('') === 'RNBQKBNR', `rank1 应为 RNBQKBNR，实际 ${p.board[7].join('')}`);
  assert(p.board[4].join('') === '........', 'rank4 应为空行');
  assert(p.side === 'w', `走子方应为 w，实际 ${p.side}`);
  assert(p.castling === 'KQkq', `易位权应为 KQkq，实际 ${p.castling}`);
  assert(p.ep === '-', `过路兵格应为 -，实际 ${p.ep}`);

  // 数字压缩必须展开成 '.'（Kiwipete 有多个跳格）
  const k = parseFen(KIWIPETE);
  assert(k.board[0].join('') === 'r...k..r', `Kiwipete rank8 展开错误：${k.board[0].join('')}`);
  assert(k.board[3].join('') === '...PN...', `Kiwipete rank5 展开错误：${k.board[3].join('')}`);

  // 非法 FEN 必须报错，不能静默产出半截棋盘
  const bad = [
    ['7', '8/8/8/8/8/8/8 w - - 0 1'],
    ['9 files', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w - - 0 1'],
  ];
  for (const [label, fen] of bad) {
    let threw = false;
    try {
      parseFen(fen);
    } catch {
      threw = true;
    }
    assert(threw, `${label} 的非法 FEN 未被拒绝`);
  }

  return '起始/Kiwipete 布局与 castling/ep 元数据正确，7 行与 7 列 FEN 均被拒绝';
}

// ═══════════════════════════════════════════════════════════════
//  2. perft 黄金值（跨语言一致性契约）
// ═══════════════════════════════════════════════════════════════
function checkPerft() {
  const parts = [];
  for (const [label, fen, expected] of GOLDEN) {
    for (let d = 1; d <= expected.length; d++) {
      const got = perftSync(Rules, GameState, fen, d);
      assert(
        got === expected[d - 1],
        `${label} perft(${d}) 应为 ${expected[d - 1]}，实际 ${got}`,
      );
    }
    parts.push(`${label} ${expected.join('/')}`);
  }
  // 深度 0 必须恒为 1（空走法计数基线）
  assert(perftSync(Rules, GameState, START, 0) === 1, 'perft(0) 应为 1');
  return `${GOLDEN.length} 个标准局面 d1–d3 全部命中黄金值（${parts.join('；')}）`;
}

// ═══════════════════════════════════════════════════════════════
//  3. 走子与状态推进 + Clone 深拷贝隔离
// ═══════════════════════════════════════════════════════════════
function checkMoveApplication() {
  const st = new GameState();
  const moves = Rules.GenerateAllLegalMoves(st);
  assert(moves.length === 20, `起始局面合法走法应为 20，实际 ${moves.length}`);

  const e2e4 = moves.find((m) => toUci(m) === 'e2e4');
  assert(e2e4, '起始局面应能生成 e2e4');

  const child = st.Clone();
  assert(child !== st, 'Clone 应返回新对象');
  assert(child.board !== st.board, 'Clone 应返回新棋盘数组');
  Rules.ApplyMove(child, e2e4); // 默认 recordHistory=true

  assert(child.board[4][4] === 'P', `e2e4 后 e4 应有白兵，实际 ${child.board[4][4]}`);
  assert(child.board[6][4] === '.', `e2e4 后 e2 应为空，实际 ${child.board[6][4]}`);
  assert(child.whiteToMove === false, 'e2e4 后应轮到黑方');
  assert(child.history.length === 1, `history 应记录 1 步，实际 ${child.history.length}`);

  // 深拷贝隔离：改子节点不能污染父节点
  assert(st.board[4][4] === '.', '父局面 e4 不应被改动');
  assert(st.whiteToMove === true, '父局面走子方不应被改动');
  child.board[0][0] = 'X';
  assert(st.board[0][0] === 'r', '父局面棋盘被 Clone 共享（深拷贝失败）');

  // 黑方回一步：e7e5，走子方回到白
  const reply = Rules.GenerateAllLegalMoves(child).find((m) => toUci(m) === 'e7e5');
  assert(reply, '黑方应能生成 e7e5');
  Rules.ApplyMove(child, reply, false);
  assert(child.board[3][4] === 'p', 'e7e5 后 e5 应有黑兵');
  assert(child.whiteToMove === true, 'e7e5 后应轮到白方');

  return 'e2e4 / e7e5 两步推进正确，走子方轮转，Clone 深拷贝与父局面隔离';
}

// ═══════════════════════════════════════════════════════════════
//  4. UCI 记法（含升变后缀）
// ═══════════════════════════════════════════════════════════════
function checkUciFormat() {
  const files = 'abcdefgh';
  const mk = (fr, fc, tr, tc, promotion = '.') => ({ fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, promotion });
  assert(toUci(mk(6, 4, 4, 4)) === 'e2e4', `e2e4 记法错误：${toUci(mk(6, 4, 4, 4))}`);
  assert(toUci(mk(0, 0, 0, 7)) === 'a8h8', `a8h8 记法错误：${toUci(mk(0, 0, 0, 7))}`);
  assert(toUci(mk(1, 0, 0, 0, 'q')) === 'a7a8q', '升变后缀应小写 q');
  assert(toUci(mk(1, 7, 0, 7, 'N')) === 'h7h8n', '升变大写 N 应归一为 n');

  // 与引擎实际生成的走法一致：起始局面 20 步全部落在 4 字符 UCI 形式
  const st = new GameState();
  for (const m of Rules.GenerateAllLegalMoves(st)) {
    const s = toUci(m);
    assert(/^[a-h][1-8][a-h][1-8]$/.test(s), `非法 UCI 形式：${s}`);
    assert(files.includes(s[0]) && files.includes(s[2]), `UCI 列字母越界：${s}`);
  }
  return '普通走子与升变后缀的 UCI 记法正确，20 条合法走法全部符合格式';
}

// ═══════════════════════════════════════════════════════════════
//  5. AI 搜索（找杀 / 吃子，且结果必须合法）
// ═══════════════════════════════════════════════════════════════
function checkAiSearch() {
  // 一步杀：白车 a1 -> a8 将死（黑王 g8，f7/g7/h7 被自家兵堵死）
  const mateFen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  const mateState = buildGameState(GameState, mateFen);
  const mate = AIEngine.FindBestMove(mateState, 2);
  assert(mate, '一侧杀局面 AI 应返回走法');
  assert(toUci(mate) === 'a1a8', `一步杀应走 a1a8（Ra8#），实际 ${toUci(mate)}`);

  // 白后白吃：白 rook d1 可沿 d 列直接吃掉 d5 的黑后
  const queenFen = '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1';
  const queenState = buildGameState(GameState, queenFen);
  const capture = AIEngine.FindBestMove(queenState, 2);
  assert(capture, '白吃黑后局面 AI 应返回走法');
  assert(toUci(capture) === 'd1d5', `应吃 d5 的黑后（d1d5），实际 ${toUci(capture)}`);

  // 返回的走法必须是当前局面合法走法之一（不能凭空造步）
  const legal = new Set(Rules.GenerateAllLegalMoves(queenState).map(toUci));
  assert(legal.has(toUci(capture)), `AI 走法 ${toUci(capture)} 不在合法走法表里`);

  // 真正的将死局面（Ra8# 之后，黑方走）：不应有任何合法走法，也不能让引擎崩
  const checkmateFen = 'R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1';
  const matedState = buildGameState(GameState, checkmateFen);
  const legalForMated = Rules.GenerateAllLegalMoves(matedState);
  assert(legalForMated.length === 0, `被将死一方不应有合法走法，实际 ${legalForMated.length}`);

  return '一步杀命中 a1a8(Ra8#)、白后白吃命中 d1d5，走法均合法，Ra8# 后将死方无合法走法';
}

// ═══════════════════════════════════════════════════════════════
//  main
// ═══════════════════════════════════════════════════════════════
console.log('lab (chess) 无头自检（纯规则/AI，不起子进程引擎、不开窗口）');
check('FEN 解析与校验', checkFen);
check('perft 黄金值（跨语言契约）', checkPerft);
check('走子与状态推进', checkMoveApplication);
check('UCI 记法', checkUciFormat);
check('AI 搜索', checkAiSearch);

if (FAILS.length > 0) {
  console.log(`FAIL: ${FAILS.length} 项检查未通过`);
  for (const f of FAILS) console.log(`  - ${f}`);
  process.exit(1);
}

console.log(
  'selfcheck ok: FEN 解析校验 + perft 黄金值（起始/Kiwipete/WP-3/WP-5 的 d1–d3）+ '
    + '走子推进与 Clone 深拷贝隔离 + UCI 记法 + AI 找杀与吃子',
);
process.exit(0);
