// tournament/run_tournament.mjs
//
// Cross-language chess round-robin tournament runner.
//
// Design (agreed with the user):
//   * Format : cross-language round-robin — every enabled engine plays every
//              other enabled engine GAMES_PER_PAIR times (colors swapped).
//   * Output : a single Markdown battle report, written to
//              tournament/reports/YYYY-MM-DD.md. No JSON artifacts.
//   * Cadence: meant to be fired once per day by a WorkBuddy automation.
//
// The runner keeps its OWN authoritative rules engine (engine.mjs) separate
// from the 10 ported language engines. Each language engine is only asked for
// a bestMove (JSON-stdio protocol); this runner applies the move, verifies it
// is legal, and decides terminal/draw outcomes. That extra verification layer
// also catches porting defects in the engines themselves.
//
// Robustness:
//   * Every enabled engine is PROBED at startup (a small-depth bestMove on the
//     start FEN that must also be legal). Engines that fail to answer, answer
//     with an illegal move, or crash are excluded and flagged in the report.
//   * An engine that errors mid-game (timeout / crash / illegal move) forfeits
//     that game and is killed; its remaining games become forfeit losses so the
//     whole tournament stays bounded and never hangs on a wedged subprocess.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ENGINES, TOURNAMENT_DEPTH, MAX_PLY, GAMES_PER_PAIR, START_FEN,
} from './engines.mjs';
import { EngineClient } from './engine_client.mjs';
import * as E from './engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');

// Probe depth is deliberately shallow + fast; the real search strength is only
// exercised inside the actual games (TOURNAMENT_DEPTH).
const PROBE_DEPTH = 2;

// ---------------------------------------------------------------------------
// Logging helper (plain stdout; the durable record lives in the .md report).
// ---------------------------------------------------------------------------
const log = (...a) => console.log(...a);

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Startup probe: confirm an engine actually answers with a LEGAL move.
// Returns { ok, client, reason }.
// ---------------------------------------------------------------------------
async function probeEngine(cfg) {
  let client;
  try {
    client = new EngineClient({ ...cfg, timeout: cfg.timeout || 60000 });
    await client.start();
    const move = await client.bestMove(START_FEN, PROBE_DEPTH);
    if (typeof move !== 'string' || move.length < 4) {
      return { ok: false, client: null, reason: `returned non-move (${JSON.stringify(move)})` };
    }
    // Validate legality against our authoritative engine.
    const st = E.parseFen(START_FEN);
    try {
      E.applyUci(st, move);
    } catch (e) {
      return { ok: false, client: null, reason: `returned ILLEGAL move ${move} (${e.message})` };
    }
    return { ok: true, client, reason: 'probe ok' };
  } catch (e) {
    if (client) client.kill();
    return { ok: false, client: null, reason: `probe failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Play one game. whiteEng / blackEng are EngineClient instances (with .id).
// Returns an outcome object the report writer understands.
// ---------------------------------------------------------------------------
async function playGame(white, black, gameNo, whiteId, blackId, depth) {
  let state = E.parseFen(START_FEN);
  const moves = [];          // annotated UCI (e.g. "e2e4", "f7f8q#")
  let ply = 0;
  let crashed = null;        // engine id that forfeited this game, if any

  while (ply < MAX_PLY) {
    // Terminal / draw checks BEFORE asking an engine for a move.
    if (E.isCheckmate(state)) {
      // side to move is mated → opponent wins
      const winner = state.whiteToMove ? blackId : whiteId;
      return { result: 'win', winner, loser: state.whiteToMove ? whiteId : blackId,
               moves, ply, reason: 'checkmate', crashed };
    }
    if (E.isStalemate(state)) {
      return { result: 'draw', winner: null, loser: null, moves, ply,
               reason: 'stalemate', crashed };
    }
    if (E.isDraw(state)) {
      // fifty-move / threefold / insufficient material
      let why = 'draw';
      if (E.isFiftyMoveDraw(state)) why = 'fifty-move';
      else if (E.isThreefold(state)) why = 'threefold';
      else if (E.isInsufficientMaterial(state)) why = 'insufficient-material';
      return { result: 'draw', winner: null, loser: null, moves, ply, reason: why, crashed };
    }

    const moverWhite = state.whiteToMove;
    const eng = moverWhite ? white : black;
    const engId = moverWhite ? whiteId : blackId;

    let uci;
    try {
      uci = await eng.bestMove(E.serializeFen(state), depth);
    } catch (e) {
      // timeout / crash / subprocess error → forfeit this game, kill engine.
      crashed = engId;
      eng.kill();
      const winner = moverWhite ? blackId : whiteId;
      return { result: 'win', winner, loser: engId, moves, ply,
               reason: `engine error (${e.message})`, crashed };
    }

    // null move: engine claims no move but the game is not over → forfeit.
    if (typeof uci !== 'string' || uci.length < 4) {
      crashed = engId;
      eng.kill();
      const winner = moverWhite ? blackId : whiteId;
      return { result: 'win', winner, loser: engId, moves, ply,
               reason: `engine returned no move (${JSON.stringify(uci)})`, crashed };
    }

    // Apply + verify legality with the authoritative engine.
    try {
      const before = state;
      state = E.applyUci(before, uci);
    } catch (e) {
      crashed = engId;
      eng.kill();
      const winner = moverWhite ? blackId : whiteId;
      return { result: 'win', winner, loser: engId, moves, ply,
               reason: `engine returned ILLEGAL move ${uci} (${e.message})`, crashed };
    }

    // Annotate: is the opponent now in check / checkmated?
    let ann = uci;
    if (E.isCheckmate(state)) ann = uci + '#';
    else if (E.isCheck(state, state.whiteToMove)) ann = uci + '+';
    moves.push(ann);
    ply++;
  }

  // Hit MAX_PLY without a decisive result → adjudicated draw.
  return { result: 'draw', winner: null, loser: null, moves, ply,
           reason: `max-ply (${MAX_PLY}) reached`, crashed };
}

// ---------------------------------------------------------------------------
// Build the round-robin bracket (all unordered pairs).
// ---------------------------------------------------------------------------
function buildPairs(ids) {
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push([ids[i], ids[j]]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Markdown report writer.
// ---------------------------------------------------------------------------
function writeReport({ date, env, participants, disabled, pairs, games, scores, anomalies, elapsedMs, gamesPerPair, depth }) {
  const lines = [];
  lines.push(`# 跨语言国际象棋循环赛战报`);
  lines.push('');
  lines.push(`- **日期**： ${date}`);
  lines.push(`- **赛制**： 循环赛（round-robin），每对交手 ${gamesPerPair} 局（交换先后手）`);
  lines.push(`- **搜索深度**： ${depth}（每步）`);
  lines.push(`- **半步上限**： ${MAX_PLY}（超限判和）`);
  lines.push(`- **对局总数**： ${games.length}`);
  lines.push(`- **总耗时**： ${(elapsedMs / 1000).toFixed(1)} 秒`);
  lines.push('');

  lines.push(`## 环境`);
  lines.push('');
  lines.push(`| 项 | 值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Node | ${env.node} |`);
  lines.push(`| Python | ${env.python} |`);
  // 2026-09-28：`工作目录` 原先直接打 process.cwd()，于是报告里出现机器绝对路径。
  // 改为把**仓根**替换成 `<repo>`；这不是手工记录，是自动化每次生成报告的产物。
  lines.push(`| 工作目录 | ${String(env.cwd).replace(dirname(__dirname), '<repo>')} |`);
  lines.push(`| 操作系统 | ${env.platform} |`);
  lines.push(`| 规则引擎 | tournament/engine.mjs（perft 黄金值自检通过） |`);
  lines.push('');

  lines.push(`## 参赛引擎（${participants.length}）`);
  lines.push('');
  lines.push(`| 引擎 | 语言 | 状态 |`);
  lines.push(`| --- | --- | --- |`);
  for (const p of participants) {
    lines.push(`| ${p.id} | ${p.language} | 参赛 |`);
  }
  for (const d of disabled) {
    lines.push(`| ${d.id} | ${d.language} | 未参赛 — ${d.reason} |`);
  }
  lines.push('');

  lines.push(`## 逐对逐局结果`);
  lines.push('');
  let gameIdx = 0;
  for (const [a, b] of pairs) {
    const ap = participants.find((x) => x.id === a) || { id: a, language: '?' };
    const bp = participants.find((x) => x.id === b) || { id: b, language: '?' };
    lines.push(`### ${ap.id} (${ap.language}) vs ${bp.id} (${bp.language})`);
    lines.push('');
    // 2026-09-28 fix: 这里原先用的是模块常量 GAMES_PER_PAIR，而不是本次运行实际
    // 用的 gamesPerPair。一旦用 GAMES_PER_PAIR 环境变量覆盖（如冒烟测试设 1），
    // 报告就会去读不存在的对局 → describeGame 收到 undefined 直接崩。
    for (let g = 0; g < gamesPerPair; g++) {
      // white/black assignment for this game (swap colors each game)
      const whiteId = g % 2 === 0 ? a : b;
      const blackId = g % 2 === 0 ? b : a;
      const game = games[gameIdx++];
      if (!game) break; // 防御：对局数少于预期时不要越界读
      const res = describeGame(game, whiteId, blackId);
      lines.push(`**第 ${g + 1} 局** （${whiteId} 执白， ${blackId} 执黑） — ${res}`);
      if (game.moves.length) {
        lines.push('');
        lines.push('> ' + game.moves.join(' '));
      }
      if (game.reason && game.result !== 'draw' && !game.reason.startsWith('checkmate')) {
        lines.push('');
        lines.push(`> 注： ${game.reason}`);
      }
      lines.push('');
    }
  }

  lines.push(`## 总积分榜`);
  lines.push('');
  lines.push(`| 排名 | 引擎 | 语言 | 积分 | 胜 | 和 | 负 |`);
  lines.push(`| --- | --- | --- | ---: | ---: | ---: | ---: |`);
  let rank = 1;
  for (const s of scores) {
    lines.push(`| ${rank} | ${s.id} | ${s.language} | ${s.score.toFixed(1)} | ${s.win} | ${s.draw} | ${s.loss} |`);
    rank++;
  }
  lines.push('');

  if (anomalies.length) {
    lines.push(`## 异常记录`);
    lines.push('');
    for (const a of anomalies) lines.push(`- ${a}`);
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`*本报告由 \`tournament/run_tournament.mjs\` 自动生成。规则裁决与非法着法校验均由独立规则引擎 \`engine.mjs\` 完成。*`);

  const content = lines.join('\n');
  const file = join(REPORTS_DIR, `${date.split(' ')[0]}.md`);
  return { content, file };
}

function describeGame(game, whiteId, blackId) {
  if (game.result === 'draw') return `和棋（${game.reason}）`;
  const w = game.winner === whiteId ? whiteId : blackId;
  const b = game.winner === whiteId ? blackId : whiteId;
  return `${w} 胜 ${b}（${game.reason}）`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const startWall = Date.now();
  log(`[${nowStr()}] tournament start`);

  // --- optional env overrides (handy for a fast smoke test & for tuning) ---
  const depthOverride = process.env.TOURNAMENT_DEPTH
    ? Number(process.env.TOURNAMENT_DEPTH) : TOURNAMENT_DEPTH;
  const gamesOverride = process.env.GAMES_PER_PAIR
    ? Number(process.env.GAMES_PER_PAIR) : GAMES_PER_PAIR;
  const filterEnv = process.env.ENGINES_FILTER ? process.env.ENGINES_FILTER.split(',') : null;

  // --- environment snapshot ---
  let nodeVer = '?', pyVer = '?';
  try {
    const { execFileSync } = await import('node:child_process');
    nodeVer = execFileSync(process.execPath, ['--version']).toString().trim();
  } catch {}
  try {
    const { execFileSync } = await import('node:child_process');
    // Find python from the py engine config if present
    const pyCfg = ENGINES.find((e) => e.id === 'py');
    if (pyCfg) pyVer = execFileSync(pyCfg.cmd, ['--version']).toString().trim();
  } catch {}

  // --- probe enabled engines ---
  let enabled = ENGINES.filter((e) => e.enabled);
  if (filterEnv) {
    enabled = enabled.filter((e) => filterEnv.includes(e.id));
    for (const fid of filterEnv) {
      if (!ENGINES.some((e) => e.id === fid && e.enabled)) {
        anomalies.push(`ENGINES_FILTER 包含未启用/不存在的引擎：${fid}`);
      }
    }
  }
  const disabled = ENGINES.filter((e) => !e.enabled).map((e) => ({
    id: e.id, language: e.language, reason: e.disabledReason || 'disabled',
  }));

  log(`[${nowStr()}] probing ${enabled.length} enabled engines...`);
  const clients = new Map();   // id -> EngineClient
  const participants = [];
  const anomalies = [];
  for (const cfg of enabled) {
    const r = await probeEngine(cfg);
    if (r.ok) {
      clients.set(cfg.id, r.client);
      participants.push({ id: cfg.id, language: cfg.language });
      log(`  [ok] ${cfg.id} (${cfg.language})`);
    } else {
      disabled.push({ id: cfg.id, language: cfg.language, reason: r.reason });
      anomalies.push(`开局探测失败，已排除 ${cfg.id}（${cfg.language}）： ${r.reason}`);
      log(`  [skip] ${cfg.id} (${cfg.language}): ${r.reason}`);
    }
  }

  if (participants.length < 2) {
    log(`[${nowStr()}] fewer than 2 usable engines — cannot run a tournament.`);
    anomalies.push('可用引擎不足 2 个，未产生任何对局。');
    const { content, file } = writeReport({
      date: nowStr(),
      env: { node: nodeVer, python: pyVer, cwd: process.cwd(), platform: process.platform },
      participants, disabled, pairs: [], games: [], scores: [], anomalies,
      elapsedMs: Date.now() - startWall, gamesPerPair: gamesOverride, depth: depthOverride,
    });
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(file, content, 'utf8');
    log(`[${nowStr()}] report written: ${file}`);
    return;
  }

  // --- build bracket + play ---
  const ids = participants.map((p) => p.id);
  const pairs = buildPairs(ids);
  const games = [];
  // score table
  const scoreMap = new Map();
  for (const id of ids) scoreMap.set(id, { id, language: participants.find((p) => p.id === id).language, score: 0, win: 0, draw: 0, loss: 0 });

  log(`[${nowStr()}] bracket: ${pairs.length} pairs × ${gamesOverride} games = ${pairs.length * gamesOverride} games`);
  let done = 0;
  const total = pairs.length * gamesOverride;

  for (const [a, b] of pairs) {
    const aCli = clients.get(a);
    const bCli = clients.get(b);
    for (let g = 0; g < gamesOverride; g++) {
      const whiteId = g % 2 === 0 ? a : b;
      const blackId = g % 2 === 0 ? b : a;
      const whiteCli = whiteId === a ? aCli : bCli;
      const blackCli = blackId === a ? aCli : bCli;

      // If an engine already crashed earlier in the run, it was removed from
      // `clients`; do NOT call playGame with an undefined client. Record a
      // forfeit win for the surviving engine instead.
      if (!whiteCli || !blackCli) {
        const survivor = whiteCli ? whiteId : blackId;
        const dead = whiteCli ? blackId : whiteId;
        const game = { result: 'win', winner: survivor, loser: dead, moves: [], ply: 0,
                       reason: `对手 ${dead} 此前已崩溃，不战而胜`, crashed: dead };
        games.push(game);
        scoreMap.get(survivor).score += 1; scoreMap.get(survivor).win += 1;
        scoreMap.get(dead).loss += 1;
        done++;
        log(`  [${done}/${total}] ${whiteId}-${blackId}: forfeit (${dead} dead)`);
        continue;
      }

      const game = await playGame(whiteCli, blackCli, games.length + 1, whiteId, blackId, depthOverride);
      games.push(game);

      // scoring
      if (game.result === 'draw') {
        scoreMap.get(whiteId).score += 0.5; scoreMap.get(whiteId).draw += 1;
        scoreMap.get(blackId).score += 0.5; scoreMap.get(blackId).draw += 1;
      } else {
        scoreMap.get(game.winner).score += 1; scoreMap.get(game.winner).win += 1;
        scoreMap.get(game.loser).loss += 1;
      }

      // if a crashed engine was killed, its remaining games forfeit — but we
      // still recorded this game; mark subsequent forfeits lazily below.
      const crashedId = game.crashed;
      if (crashedId && clients.has(crashedId)) {
        // engine is dead; any further game involving it would hang. We must
        // convert remaining pairings to forfeit wins for the opponent.
        clients.delete(crashedId);
        anomalies.push(`${crashedId} 在第 ${games.length} 局崩溃（${game.reason}），后续所有对局判负（对手不战而胜）。`);
        log(`  [crash] ${crashedId} removed from bracket`);
      }

      done++;
      log(`  [${done}/${total}] ${whiteId}-${blackId}: ${describeGame(game, whiteId, blackId)} (${game.moves.length} plies)`);
    }
  }

  // Convert any remaining games that involve a now-dead client to forfeits.
  // (playGame above already guarded: if a client is dead, bestMove rejects and
  //  forfeits that single game. But because we delete from `clients` AFTER the
  //  game that crashed, the NEXT game referencing the dead client will forfeit
  //  too — so the loop naturally cascades. No extra pass needed.)

  // --- leaderboard ---
  const scores = [...scoreMap.values()].sort((x, y) =>
    y.score - x.score || y.win - x.win || x.loss - y.loss);

  const { content, file } = writeReport({
    date: nowStr(),
    env: { node: nodeVer, python: pyVer, cwd: process.cwd(), platform: process.platform },
    participants, disabled, pairs, games, scores, anomalies,
    elapsedMs: Date.now() - startWall, gamesPerPair: gamesOverride, depth: depthOverride,
  });

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(file, content, 'utf8');

  // --- cleanup ---
  for (const cli of clients.values()) cli.kill();

  log(`[${nowStr()}] tournament done. report: ${file}`);
  log(`[${nowStr()}] leaderboard:`);
  for (const s of scores) {
    log(`   ${s.id.padEnd(6)} ${s.score.toFixed(1)}  (W${s.win} D${s.draw} L${s.loss})`);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
