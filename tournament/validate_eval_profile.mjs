// tournament/validate_eval_profile.mjs
// Tier 2-C（差异化评估）验收门。
//
// 对每个引擎发送只读 `evalProfile` 命令，校验三件事：
//   (1) 返回的 profile 名与「引擎→档位」指派一致；
//   (2) 返回的 hash 与本文件内置的规范权重表按同一 djb2-32 算法重算结果一致
//       —— 防止「声明 A 档、实装别的数字」的漂移；
//   (3) 所有已验引擎的 hash 两两互异（风格多样性的硬约束）。
//
// 用法：node validate_eval_profile.mjs [id ...]   （缺省 = 指派表中的全部引擎）
// 批1试点只落 go/js，其余引擎在铺开批落地后自然纳入。
import { EngineClient, START_FEN } from './engine_client.mjs';
import { ENGINES } from './engines.mjs';

// ---- 10 档风格权重表（规范源；各引擎内的 EVAL_PROFILE/EvalProfile 必须与本表逐字段一致） ----
const PROFILES = {
  balanced:      { name: 'balanced',      pawnShieldMissing: 18, pawnShieldOpenFile: 12, doubledPawn: 12, isolatedPawn: 15, passedPawnBase: 20, passedPawnPerRank: 8,  bishopPair: 30, mobilityWeight: 0 },
  aggressive:    { name: 'aggressive',    pawnShieldMissing: 30, pawnShieldOpenFile: 20, doubledPawn: 8,  isolatedPawn: 10, passedPawnBase: 15, passedPawnPerRank: 6,  bishopPair: 20, mobilityWeight: 0 },
  materialist:   { name: 'materialist',   pawnShieldMissing: 8,  pawnShieldOpenFile: 4,  doubledPawn: 6,  isolatedPawn: 8,  passedPawnBase: 12, passedPawnPerRank: 4,  bishopPair: 10, mobilityWeight: 0 },
  pawnstructure: { name: 'pawnstructure', pawnShieldMissing: 12, pawnShieldOpenFile: 8,  doubledPawn: 22, isolatedPawn: 25, passedPawnBase: 25, passedPawnPerRank: 10, bishopPair: 25, mobilityWeight: 0 },
  kingsafety:    { name: 'kingsafety',    pawnShieldMissing: 35, pawnShieldOpenFile: 25, doubledPawn: 10, isolatedPawn: 12, passedPawnBase: 15, passedPawnPerRank: 5,  bishopPair: 15, mobilityWeight: 0 },
  passer:        { name: 'passer',        pawnShieldMissing: 10, pawnShieldOpenFile: 6,  doubledPawn: 8,  isolatedPawn: 10, passedPawnBase: 35, passedPawnPerRank: 14, bishopPair: 20, mobilityWeight: 0 },
  solid:         { name: 'solid',         pawnShieldMissing: 25, pawnShieldOpenFile: 15, doubledPawn: 15, isolatedPawn: 18, passedPawnBase: 18, passedPawnPerRank: 7,  bishopPair: 25, mobilityWeight: 0 },
  gambit:        { name: 'gambit',        pawnShieldMissing: 5,  pawnShieldOpenFile: 3,  doubledPawn: 4,  isolatedPawn: 5,  passedPawnBase: 10, passedPawnPerRank: 3,  bishopPair: 8,  mobilityWeight: 0 },
  hypermodern:   { name: 'hypermodern',   pawnShieldMissing: 15, pawnShieldOpenFile: 18, doubledPawn: 10, isolatedPawn: 12, passedPawnBase: 22, passedPawnPerRank: 9,  bishopPair: 45, mobilityWeight: 0 },
  endgame:       { name: 'endgame',       pawnShieldMissing: 10, pawnShieldOpenFile: 6,  doubledPawn: 10, isolatedPawn: 12, passedPawnBase: 30, passedPawnPerRank: 16, bishopPair: 18, mobilityWeight: 0 },
};

// 引擎 → 档位指派（批1试点：go=balanced, js=aggressive；其余在铺开批落地）
const ASSIGNMENT = {
  go: 'balanced', js: 'aggressive', rust: 'materialist', cpp: 'pawnstructure',
  cs: 'kingsafety', fs: 'passer', java: 'solid', py: 'gambit', ts: 'hypermodern', vb: 'endgame',
};

// ---- djb2-32 over 规范化串（与各引擎内实现逐字节同算法） ----
function canonical(p) {
  return [p.name, p.pawnShieldMissing, p.pawnShieldOpenFile, p.doubledPawn, p.isolatedPawn,
          p.passedPawnBase, p.passedPawnPerRank, p.bishopPair, p.mobilityWeight].join('|');
}
function djb2(s) {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function checkEngine(cfg, wantProfile) {
  const client = new EngineClient({ ...cfg, timeout: cfg.timeout || 60000 });
  try {
    await client.start();
    // fen 用起始局面：profile 与局面无关，但 driver 侧总是先解析 FEN 再分发，
    // 部分实现的 fromFen 不接受空串。
    const r = await client.rpc('evalProfile', START_FEN, 0, undefined);
    if (!r || !r.ok) return { ok: false, reason: `evalProfile 失败 (${JSON.stringify(r)})` };
    const checks = [];
    if (r.profile !== wantProfile) {
      checks.push(`profile 名不匹配：期望 ${wantProfile}，实得 ${r.profile}`);
    }
    const wantHash = djb2(canonical(PROFILES[wantProfile]));
    if (r.hash !== wantHash) {
      checks.push(`hash 不匹配：期望 ${wantHash}（规范表重算），实得 ${r.hash}`);
    }
    return { ok: checks.length === 0, reason: checks.join('; '), got: { profile: r.profile, hash: r.hash } };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    client.kill();
  }
}

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ASSIGNMENT);
  const results = [];
  let fail = 0;
  for (const id of ids) {
    const cfg = ENGINES.find((e) => e.id === id);
    if (!cfg) { console.log(`[FAIL] ${id} — engines.mjs 中不存在`); fail++; continue; }
    const wantProfile = ASSIGNMENT[id];
    if (!wantProfile) { console.log(`[FAIL] ${id} — 指派表中无该引擎`); fail++; continue; }
    const r = await checkEngine(cfg, wantProfile);
    if (r.ok) {
      console.log(`[PASS] ${id.padEnd(5)} profile=${r.got.profile} hash=${r.got.hash}`);
    } else {
      console.log(`[FAIL] ${id} — ${r.reason}`);
      fail++;
    }
    if (r.ok || r.got) results.push({ id, ...r.got });
  }

  // 硬约束：已通过验证的引擎之间 hash 必须两两互异。
  const seen = new Map();
  let dup = 0;
  for (const r of results) {
    if (seen.has(r.hash)) {
      console.log(`[FAIL] hash 冲突：${r.id} 与 ${seen.get(r.hash)} 同为 ${r.hash}（风格未分化）`);
      dup++;
    } else {
      seen.set(r.hash, r.id);
    }
  }
  console.log(`\nTOTAL checked=${results.length} fail=${fail} dupHash=${dup}`);
  process.exit(fail + dup > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
