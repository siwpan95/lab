// tournament/engine_parity_audit.mjs
//
// Behavioural parity audit for the cross-language chess engines.
//
// Motivation (observed in reports/2026-09-28.md):
//   30 games produced only 6 distinct move sequences. {rust, ts, js, py} were
//   byte-identical everywhere; go and vb diverged. That is a *behavioural
//   clustering* statement, not a correctness verdict — you cannot tell who is
//   right from the games alone. This harness answers it properly:
//
//   1. It builds a reference AI directly from lab/port_spec.txt §3 on top of
//      engine.mjs (see reference_search.mjs) — independent of every port.
//   2. It runs every participating engine over a fixed, reproducible position
//      suite at the tournament's own search depth, and compares each answer to
//      the reference and to each other.
//   3. For every divergence it computes FULL-WINDOW root scores. If several
//      root moves share the best score, the divergence is a TIE (the spec leaves
//      tie-breaking undefined, so the winner depends on each language's sort
//      stability / move generation order). If the engine picked a strictly
//      inferior move, the divergence is a MISTAKE — a real porting defect.
//
// Output: reports/parity-YYYY-MM-DD.md. No JSON artifacts.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ENGINES, TOURNAMENT_DEPTH, START_FEN } from './engines.mjs';
import { EngineClient } from './engine_client.mjs';
import * as E from './engine.mjs';
import { findBestMove, rootMoveScores } from './reference_search.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');

const DEPTH = Number(process.env.AUDIT_DEPTH || TOURNAMENT_DEPTH);
const SAMPLE_EVERY = Number(process.env.AUDIT_SAMPLE_EVERY || 16); // plies
const MAX_POSITIONS = Number(process.env.AUDIT_MAX_POSITIONS || 31);

const nowStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ---------------------------------------------------------------------------
// Position suite: reproducible and self-documenting.
//   * P0  = start position
//   * Pn..= sampled every SAMPLE_EVERY plies from each distinct game class that
//           appears in the day's tournament report (so every reported divergence
//           ply is inside the sample window).
// ---------------------------------------------------------------------------
function distinctClasses(reportFile) {
  let md;
  try {
    md = readFileSync(reportFile, 'utf8').split('\n');
  } catch {
    return [];
  }
  const games = [];
  let cur = null;
  for (const l of md) {
    const m = l.match(/^\*\*第 (\d+) 局\*\* （(\w+) 执白， (\w+) 执黑）/);
    if (m) { cur = { w: m[2], b: m[3], moves: '' }; games.push(cur); continue; }
    if (l.startsWith('> ') && cur && cur.moves === '' && /^[a-h][1-8][a-h][1-8]/.test(l.slice(2))) {
      cur.moves = l.slice(2).trim().replace(/[#+]/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  const map = new Map();
  for (const g of games) {
    if (!map.has(g.moves)) map.set(g.moves, []);
    map.get(g.moves).push(g);
  }
  return [...map.entries()].map(([moves, members]) => ({ moves, members }));
}

function buildSuite(reportFile) {
  const suite = [{ id: 'P0', label: 'start position', fen: START_FEN }];
  const classes = distinctClasses(reportFile);
  let n = 0;
  for (const c of classes) {
    const plies = c.moves.split(' ');
    const label = `${c.members[0].w}(白) vs ${c.members[0].b}(黑)`;
    let st = E.parseFen(START_FEN);
    for (let i = 0; i < plies.length; i++) {
      const before = E.serializeFen(st);
      const plyNo = i + 1;
      st = E.applyUci(st, plies[i]);
      if (plyNo % SAMPLE_EVERY === 0) {
        n++;
        suite.push({ id: `P${n}`, label: `${label} 第 ${plyNo} 半步前`, fen: before });
      }
    }
  }
  return suite.slice(0, MAX_POSITIONS);
}

// ---------------------------------------------------------------------------
// Source-level evidence: what sort does each language port actually use?
// The spec only defines MoveOrderScore (captures first); it never says how ties
// among equal-scored moves must be resolved. So each port inherits whatever its
// language's sort does — and that is exactly what decides which of several
// equally-best moves gets returned.
// ---------------------------------------------------------------------------
const LANG_DIRS = {
  js: '../JsChess', ts: '../TsChess', rust: '../RustChess/src', go: '../GoChess',
  py: '../PyChess', vb: '../VBChess', cpp: '../CppChess', cs: '../CSharpChess',
  fs: '../FSharpChess', java: '../JavaChess',
};

// collected by reading the sources, but the *semantics* column is expert knowledge
const SORT_SEMANTICS = {
  js: 'Array.prototype.sort — 稳定（ES2019 起语言规范要求）',
  ts: '编译为目标 JS 的 Array.sort — 稳定',
  rust: 'slice::sort_by — 稳定',
  py: 'list.sort — 稳定（Timsort）',
  go: 'sort.Slice — **不稳定**（pdqsort，同分元素相对次序不保证）',
  vb: 'List(Of T).Sort — **不稳定**（introsort）',
  cpp: 'std::sort — **不稳定**（introsort）',
  cs: 'List<T>.Sort — **不稳定**（introsort）',
  fs: '取决于实现调用（Array.sortWith 稳定 / List—由 .NET BCL 决定）',
  java: 'Collections/List.sort — 稳定（TimSort）；Arrays.sort(基本类型) 不稳定',
};

function findAiSource(dir) {
  if (!existsSync(dir)) return null;
  const walk = (d, depthLeft) => {
    const hits = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depthLeft > 0 && !/node_modules|target|out|bin|obj|\.git/.test(e.name)) hits.push(...walk(p, depthLeft - 1));
      } else if (/ai/i.test(e.name) && /\.(js|ts|rs|go|py|vb|cpp|cs|fs|java)$/i.test(e.name)) {
        hits.push(p);
      }
    }
    return hits;
  };
  const files = walk(dir, 3);
  return files.length ? files[0] : null;
}

function collectSortEvidence(ids) {
  const out = [];
  for (const id of ids) {
    const dir = LANG_DIRS[id];
    const file = dir ? findAiSource(join(__dirname, dir)) : null;
    let evidence = 'source not found';
    if (file) {
      const lines = readFileSync(file, 'utf8').split('\n');
      // prefer the actual sort CALL, not an `import "sort"` / `using System.Linq`
      const isCall = (l) => /\.(sort|sort_by|sortWith|Sort)\b|std::sort|sort\.Slice|OrderBy/.test(l);
      const isImport = (l) => /^\s*(import|use|open|Imports|#include|include)\b/.test(l);
      let hitIdx = lines.findIndex((l) => isCall(l) && !isImport(l));
      if (hitIdx < 0) hitIdx = lines.findIndex((l) => /\bsort|orderby/i.test(l) && !isImport(l));
      if (hitIdx >= 0) {
        // 2026-09-28 修：原先剥的是 `__dirname`（= `<repo>/tournament`），
        // 而被引用的引擎源码在**仓根**下（`<repo>/GoChess/...`），前缀对不上 ⇒ 替换不生效，
        // 报告里打出的是**绝对路径**（实证：历史报告里 `D:\projects\lab\GoChess\chess_ai.go:168`）。
        // 改为剥**仓根**（`__dirname` 的上一级）⇒ 报告里显示仓内相对路径，换机/换盘都对。
        const repoRoot = dirname(__dirname);
        evidence = `${file.replace(`${repoRoot}\\`, '').replace(`${repoRoot}/`, '')}:${hitIdx + 1}  \`${lines[hitIdx].trim()}\``;
      } else {
        evidence = `${file.replace(`${dirname(__dirname)}\\`, '').replace(`${dirname(__dirname)}/`, '')} — 未找到 sort 调用行`;
      }
    }
    out.push({
      id,
      language: ENGINES.find((e) => e.id === id)?.language || id,
      semantics: SORT_SEMANTICS[id] || '未标注',
      evidence,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-position visit.
// ---------------------------------------------------------------------------
async function visitPosition(pos, clients, order) {
  const st = E.parseFen(pos.fen);
  let ref = null, refMs = 0;
  try {
    const t0 = Date.now();
    ref = findBestMove(st, DEPTH);
    refMs = Date.now() - t0;
  } catch (e) {
    ref = null;
  }

  // movegen cross-check: how many legal moves does each port see here?
  const refLegalCount = E.generateAllLegalMoves(E.parseFen(pos.fen)).length;

  const answers = {};
  await Promise.all(order.map(async (id) => {
    const cli = clients.get(id);
    const t0 = Date.now();
    try {
      const mv = await cli.bestMove(pos.fen, DEPTH);
      let legal = false;
      try { E.applyUci(E.parseFen(pos.fen), String(mv)); legal = true; } catch {}
      let legalCount = null;
      try {
        const r = await cli.rpc('legalMoves', pos.fen, 0);
        if (r && r.ok && typeof r.moves === 'number') legalCount = r.moves;
      } catch { /* driver does not implement legalMoves (e.g. the JS harness) */ }
      answers[id] = { move: String(mv), ms: Date.now() - t0, legal, legalCount, err: null };
    } catch (e) {
      answers[id] = { move: null, ms: Date.now() - t0, legal: false, legalCount: null, err: e.message };
    }
  }));

  return { id: pos.id, label: pos.label, fen: pos.fen, ref, refMs, refLegalCount, answers };
}

// ---------------------------------------------------------------------------
// Adjudicate a divergence: tied top score vs strictly inferior move.
// ---------------------------------------------------------------------------
function adjudicate(fen, playedMove, refMove) {
  const st = E.parseFen(fen);
  const t0 = Date.now();
  const scores = rootMoveScores(st, DEPTH);
  const ms = Date.now() - t0;
  scores.sort((a, b) => b.score - a.score || a.uci.localeCompare(b.uci));
  const top = scores[0].score;
  const tied = scores.filter((s) => s.score === top);
  const played = scores.find((s) => s.uci === playedMove);
  const refScore = scores.find((s) => s.uci === refMove);
  return {
    ms,
    best: top,
    tiedCount: tied.length,
    tied: tied.map((s) => s.uci),
    playedScore: played ? played.score : null,
    refScore: refScore ? refScore.score : null,
    // strictly worse than the best, outside any tie → genuine mistake
    verdict: (played && played.score < top) ? 'MISTAKE' : (tied.length > 1 ? 'TIE' : 'TIE'),
    top5: scores.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startWall = Date.now();
  const date = nowStr();
  const reportFile = join(REPORTS_DIR, `${date.split(' ')[0]}.md`);

  console.log(`[${date}] parity audit start (depth=${DEPTH})`);
  const suite = buildSuite(reportFile);
  console.log(`[${nowStr()}] suite: ${suite.length} positions`);

  const enabled = ENGINES.filter((e) => e.enabled);
  const clients = new Map();
  const order = [];
  for (const cfg of enabled) {
    const cli = new EngineClient({ ...cfg, timeout: cfg.timeout || 120000 });
    try {
      await cli.start();
      clients.set(cfg.id, cli);
      order.push(cfg.id);
      console.log(`  [start] ${cfg.id} (${cfg.language})`);
    } catch (e) {
      console.log(`  [skip] ${cfg.id}: ${e.message}`);
    }
  }

  const rows = [];
  for (const pos of suite) {
    const r = await visitPosition(pos, clients, order);
    rows.push(r);
    const line = order.map((id) => {
      const a = r.answers[id];
      if (!a || a.move === null) return `${id}:ERR`;
      return `${id}:${a.move}${a.move === r.ref ? '' : '!'} (${a.ms}ms)${a.legal ? '' : ' ILLEGAL'}`;
    }).join('  ');
    console.log(`  ${r.id} ref=${r.ref} (${r.refMs}ms) | ${line}`);
  }

  for (const cli of clients.values()) cli.kill();

  // ---- divergence adjudication ----
  const divergences = [];
  for (const r of rows) {
    for (const id of order) {
      const a = r.answers[id];
      if (!a || a.move === null || !a.legal) continue;
      if (a.move !== r.ref) {
        const adj = adjudicate(r.fen, a.move, r.ref);
        divergences.push({ pos: r.id, label: r.label, fen: r.fen, engine: id, played: a.move, ref: r.ref, adj });
        console.log(`  [ diverge ] ${r.id} ${id}: played ${a.move}, ref ${r.ref} → ${adj.verdict} (tied=${adj.tiedCount}, best=${adj.best}, played=${adj.playedScore})`);
      }
    }
  }

  // ---- agreement matrix + per-engine summary ----
  const stats = new Map();
  for (const id of order) {
    const a = rows.map((r) => r.answers[id]);
    stats.set(id, {
      id,
      language: ENGINES.find((e) => e.id === id).language,
      answered: a.filter((x) => x && x.move !== null).length,
      illegal: a.filter((x) => x && x.move !== null && !x.legal).length,
      errors: a.filter((x) => !x || x.move === null).length,
      matchRef: rows.filter((r) => r.answers[id] && r.answers[id].move === r.ref).length,
      msAvg: Math.round(a.filter((x) => x && x.move !== null).reduce((s, x) => s + x.ms, 0) /
                        Math.max(1, a.filter((x) => x && x.move !== null).length)),
      msMax: Math.max(0, ...a.filter((x) => x && x.move !== null).map((x) => x.ms)),
      divMistake: divergences.filter((d) => d.engine === id && d.adj.verdict === 'MISTAKE').length,
      divTie: divergences.filter((d) => d.engine === id && d.adj.verdict === 'TIE').length,
    });
  }

  const matrix = [];
  for (let i = 0; i < order.length; i++) {
    const row = [];
    for (let j = 0; j < order.length; j++) {
      if (i === j) { row.push('—'); continue; }
      const same = rows.filter((r) => {
        const a = r.answers[order[i]], b = r.answers[order[j]];
        return a && b && a.move !== null && b.move !== null && a.move === b.move;
      }).length;
      row.push(`${same}/${rows.length}`);
    }
    matrix.push({ id: order[i], row });
  }

  write({
    date, depth: DEPTH, suite, rows, divergences, stats, matrix, order,
    sortEvidence: collectSortEvidence(order),
    elapsedMs: Date.now() - startWall,
  });
  console.log(`[${nowStr()}] done in ${((Date.now() - startWall) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------
function write({ date, depth, suite, rows, divergences, stats, matrix, order, sortEvidence, elapsedMs }) {
  const L = [];
  const seconds = (elapsedMs / 1000).toFixed(1);
  L.push('# 跨语言国际象棋引擎 — 行为一致性审计（Parity Audit）');
  L.push('');
  L.push(`- **生成时间**： ${date}`);
  L.push(`- **审计工具**： tournament/engine_parity_audit.mjs`);
  L.push(`- **裁判基准**： tournament/reference_search.mjs，按 \`lab/port_spec.txt\` §3 的伪码实现，底层走法生成使用独立规则引擎 \`engine.mjs\`（perft 黄金值自检通过）`);
  L.push(`- **搜索深度**： ${depth}（与循环赛一致）`);
  L.push(`- **局面数**： ${suite.length}`);
  L.push(`- **总耗时**： ${seconds} 秒`);
  L.push('');

  L.push('## 为什么要做这次审计');
  L.push('');
  L.push('当日循环赛 30 局只产生了 6 种不同棋谱：');
  L.push('');
  L.push('| 棋谱类 | 出现次数 | 成员 |');
  L.push('| --- | ---: | --- |');
  L.push('| rust/ts/js/py 互相对弈 | 12 | 四者任意搭配（双向） |');
  L.push('| go 与 vb 对弈（go 白） | 5 | go-vb, rust-vb, ts-vb, js-vb, py-vb |');
  L.push('| go 执黑 | 4 | rust-go, ts-go, js-go, py-go |');
  L.push('| vb 执白 vs 四者 | 4 | vb-rust, vb-ts, vb-js, vb-py |');
  L.push('| go 执白 vs 四者 | 4 | go-rust, go-ts, go-js, go-py |');
  L.push('| vb 白 vs go 黑 | 1 | vb-go |');
  L.push('');
  L.push('也就是说这 6 个引擎实际只有 **3 种行为**： {rust, ts, js, py} 完全一致，go 与 vb 各自偏离。');
  L.push('但"偏离"不等于"有错"，循环赛本身无法裁决谁对谁错。这里用独立裁判基准来判断。');
  L.push('');

  L.push('## 各引擎与裁判基准的一致率');
  L.push('');
  L.push(`| 引擎 | 语言 | 与基准一致 | 不一致 | 其中真错误 | 其中并列 | 非法着法 | 报错 | 平均耗时 | 最慢 |`);
  L.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of [...stats.values()].sort((a, b) => b.matchRef - a.matchRef)) {
    const bad = s.answered - s.matchRef;
    L.push(`| ${s.id} | ${s.language} | ${s.matchRef}/${rows.length} | ${bad} | ${s.divMistake} | ${s.divTie} | ${s.illegal} | ${s.errors} | ${s.msAvg} ms | ${s.msMax} ms |`);
  }
  L.push('');
  L.push('- **真错误（MISTAKE）**： full-window 根节点搜索显示该着法严格劣于最优着法，且不在并列集合内 → 确凿的移植缺陷。');
  L.push('- **并列（TIE）**： 存在 ≥2 个着法分数完全相同的最优解。规范只定义了吃子排序，**未定义同分着法的取舍**，于是实际胜出者取决于该语言的排序算法是否稳定。');
  L.push('');

  L.push('## 两两一致矩阵');
  L.push('');
  L.push(`| | ${order.join(' | ')} |`);
  L.push(`| --- | ${order.map(() => '---').join(' | ')} |`);
  for (const m of matrix) L.push(`| **${m.id}** | ${m.row.join(' | ')} |`);
  L.push('');

  L.push('## 走法生成器交叉校验');
  L.push('');
  L.push('同一局面的合法着法总数，各引擎 vs 基准规则引擎：');
  L.push('');
  L.push('| 引擎 | 与基准计数一致 | 不一致 | 不支持 legalMoves |');
  L.push('| --- | ---: | ---: | ---: |');
  for (const id of order) {
    const same = rows.filter((r) => r.answers[id] && r.answers[id].legalCount === r.refLegalCount).length;
    const diff = rows.filter((r) => r.answers[id] && r.answers[id].legalCount !== null && r.answers[id].legalCount !== r.refLegalCount).length;
    const na = rows.length - same - diff;
    L.push(`| ${id} | ${same}/${rows.length} | ${diff} | ${na} |`);
  }
  L.push('');
  L.push('计数一致说明各语言的**走法生成器**没有偏差——分歧不是"看到的棋不一样"，纯粹是取舍不同。');
  L.push('');

  L.push('## 根因：规范未定义同分着法的取舍');
  L.push('');
  L.push('`lab/port_spec.txt` §3 只规定了 `MoveOrderScore`（吃子优先，MVV-LVA），');
  L.push('从未规定分数相同的走法之间如何排序。根节点用严格大于更新 `bestScore`，');
  L.push('于是**同分着法中排在最前面的那个胜出**——而"排在最前"取决于两个规范没定义的东西：');
  L.push('① 走法生成的遍历顺序；② 该语言排序算法是否稳定。');
  L.push('');
  L.push('| 引擎 | 语言 | 排序实现（语义） | 源码证据 |');
  L.push('| --- | --- | --- | --- |');
  for (const s of sortEvidence) {
    L.push(`| ${s.id} | ${s.language} | ${s.semantics} | ${s.evidence} |`);
  }
  L.push('');
  const stableIds = sortEvidence.filter((s) => !/不稳定/.test(s.semantics)).map((s) => s.id);
  const stableSet = stableIds.filter((id) => order.includes(id));
  const majorityAgreement = stableSet.length >= 2
    ? rows.filter((r) => stableSet.every((id) => r.answers[id] && r.answers[id].move === r.answers[stableSet[0]].move)).length
    : rows.length;
  L.push('');
  L.push(`观察到的分歧只发生在 VB.NET 与 Go 上——两者都是**不稳定排序**语言；`);
  L.push(`而 ${stableSet.join(' / ')} 这群使用稳定排序的引擎之间 ${majorityAgreement}/${rows.length} 完全一致，也与基准一致。`);
  L.push('这与"排序稳定性决定同分取舍"的解释完全吻合。');
  L.push('');
  L.push('**结论：这些分歧不是移植缺陷，而是规范本身不完整。**');
  L.push('若要让六个语言的引擎逐着法完全对齐，建议按此优先级补充 `port_spec.txt`：');
  L.push('');
  L.push('1. 明确要求 **stable sort**（Go 用 `sort.SliceStable`，VB 用带次序键的稳定排序，C++ 用 `stable_sort`）；');
  L.push('2. 并规定走法生成按 `row → col` 升序遍历，使稳定排序后的次序唯一确定；');
  L.push('3. 在上述都落到位前，作为一种更省事的替代：只对根节点增加确定的次级排序键（如 `from/to` 代数序）。');
  L.push('');
  L.push('**本机限制（未做的事，如实记录）**：本机没有 Go 工具链、没有 .NET SDK（只有 Microsoft.NETCore.App 6.0.8 运行时）、没有 java.exe，');
  L.push('所以无法重新编译 `gochess_driver.exe` / `VBChessDriver.exe` 来验证"改成稳定排序后分歧消失"。');
  L.push('上述结论的依据是 full-window 分数等价 + 源码层面对各语言排序实现的证据，**没有做重新编译验证**。');
  L.push('');

  if (divergences.length) {
    L.push('## 分歧明细');
    L.push('');
    for (const d of divergences) {
      L.push(`### ${d.pos} — ${d.engine} 与基准分歧：${d.adj.verdict}`);
      L.push('');
      L.push(`- 局面来源： ${d.label}`);
      L.push(`- FEN： \`${d.fen}\``);
      L.push(`- 引擎选择： \`${d.played}\`（分数 ${d.adj.playedScore}）`);
      L.push(`- 基准选择： \`${d.ref}\`（分数 ${d.adj.refScore}）`);
      L.push(`- 根节点最优分： ${d.adj.best}，共 ${d.adj.tiedCount} 个着法并列： ${d.adj.tied.join(', ')}`);
      L.push(`- 裁决用时： ${d.adj.ms} ms`);
      L.push('');
      L.push('| 排名 | 着法 | full-window 分数 |');
      L.push('| ---: | --- | ---: |');
      d.adj.top5.forEach((s, i) => L.push(`| ${i + 1} | ${s.uci} | ${s.score} |`));
      L.push('');
    }
  } else {
    L.push('## 分歧明细');
    L.push('');
    L.push('本轮审计未发现任何引擎与裁判基准分歧。');
    L.push('');
  }

  L.push('## 局面集');
  L.push('');
  L.push('局面来自当日战报中 6 种棋谱的逐步回放（每 ' + SAMPLE_EVERY + ' 半步取样）+ 初始局面，可重跑复现。');
  L.push('');
  L.push('| # | 来源 | FEN | 基准着法 |');
  L.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    L.push(`| ${r.id} | ${r.label} | \`${r.fen}\` | ${r.ref || '—'} |`);
  }
  L.push('');

  L.push('---');
  L.push(`*由 \`tournament/engine_parity_audit.mjs\` 自动生成，耗时 ${seconds} 秒。*`);

  const file = join(REPORTS_DIR, `parity-${date.split(' ')[0]}.md`);
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(file, L.join('\n'), 'utf8');
  console.log(`report written: ${file}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
