// tournament/engines.mjs
// Engine manifest for the cross-language tournament. Each entry is a JSON-stdio
// driver the EngineClient can spawn.
//
// NOTE (2026-09-28): this file no longer hard-codes any absolute path. Repo paths
// are derived from this file's own location, and toolchains come from the
// environment / PATH. See the "去本地化" block below for the overrides.
//
// The runner PROBES every enabled engine at startup; only engines that actually
// answer join the bracket. Engines marked `disabled` are skipped outright and
// noted in the report (no fake results, no wasted startup time).
//
// Participating (enabled):
//   go, rust, vb, ts, js, py  — original 6 (no extra runtime needed)
//   cpp, cs, fs              — enabled 2026-09-28 after a .NET 8 runtime became
//                                available + cpp JSON-stdio driver verified
//   java                     — enabled 2026-09-28 after JDK 21 became available;
//                                JavaChess core compiled to out/
//
// Previously disabled (now resolved):
//   cpp  — was "excluded by user decision"; the JSON-stdio driver
//          (chess-cordis/drivers/cpp/cppchess_driver.exe) is prebuilt & verified.
//   cs/fs — needed .NET 8 runtime; only Microsoft.NETCore.App 6.0.8 was present.
//   java — no java.exe runtime on the machine at the time.
//
// `depth` is the per-move search depth (user-selected strength = 3; the daily
// automation overrides it to 4).
// `timeout` is the per-move RPC ceiling; python is slow → generous one.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { START_FEN } from './engine_client.mjs';

export const TOURNAMENT_DEPTH = 3; // user-selected strength
export const MAX_PLY = 160;        // hard cap on half-moves per game (draw if exceeded)
export const GAMES_PER_PAIR = 2;   // swap colors

// ---------------------------------------------------------------------------
// 去本地化（2026-09-28）：原先这里写死了 `...`、`D:/dotnet8`、
// `D:/jdk21`、以及**另一台机器的用户目录** `C:/Users/13122/...` —— 那些路径在本机
// 全部不存在（`projects` 目录实测不存在）。改为：
//
//   · 仓内一切路径 → 由**本文件位置**推导（`import.meta.url`），克隆到哪都对；
//   · 外部工具链 → 优先环境变量，其次 PATH 上的同名可执行文件；
//   · node → 直接用**正在跑本脚本的那个** node（`process.execPath`），零配置。
//
// 需要覆盖时（例如工具链装在非 PATH 位置），两种等价方式：
//   ① 环境变量：LAB_NODE / LAB_PYTHON / LAB_DOTNET / LAB_JAVA
//   ② 仓内文件：tournament/local.env（不入库，模板见 local.env.example）
//      —— 推荐给无人值守的定时任务用：进程 env 是启动快照，local.env 每次运行都读。
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/tournament
const ROOT = dirname(HERE);                            // <repo>
/** 仓内路径：repo('chess-cordis', 'drivers', ...) */
const repo = (...p) => join(ROOT, ...p);

// ---------------------------------------------------------------------------
// 本机工具链覆盖：tournament/local.env（2026-09-28 新增，**不入库**）
//
// 为什么需要它：进程的环境变量是**启动时的快照**。实测（2026-09-28 22:19）——
// 用 setx 写好的用户级 LAB_DOTNET / LAB_JAVA，在 setx 之前启动的进程树里根本读不到
// （父链根进程 22:09:14 启动 < setx 22:14）。每日自动化正是由那棵进程树派生的，
// 于是凌晨那轮拿不到 .NET 8 / JDK 21，只剩 7 个引擎。
//
// 为什么不直接把路径写进 engines.mjs 或自动化命令：机器专属路径一旦进入任何会被
// 推送/分发的文本，就变成"每次分发都要改一遍"。⇒ 机器相关的一律留在本地。
//
// 文件格式：每行 KEY=VALUE，# 开头为注释，允许 export 前缀与引号。见 local.env.example。
// 优先级：**进程环境变量 > local.env > 默认值（PATH 上的同名可执行文件）**
//   —— 与常见 dotenv 语义一致：文件只做兜底，进程里显式指定的永远优先。
// ---------------------------------------------------------------------------
const LOCAL_ENV_FILE = join(HERE, 'local.env');

function loadLocalEnv(file) {
  try {
    if (!existsSync(file)) return {};
    const out = {};
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/i, '');
      let val = line.slice(eq + 1).trim();
      const quoted = (val.startsWith('"') && val.endsWith('"')) ||
                     (val.startsWith("'") && val.endsWith("'"));
      if (quoted && val.length >= 2) val = val.slice(1, -1);
      if (key) out[key] = val;
    }
    return out;
  } catch {
    return {}; // 读不到就当没有：绝不因为配置文件缺失而让整个赛程起不来
  }
}

const LOCAL_ENV = loadLocalEnv(LOCAL_ENV_FILE);
const envOr = (key, fallback) => process.env[key] || LOCAL_ENV[key] || fallback;

const NODE = envOr('LAB_NODE', process.execPath);
const PY = envOr('LAB_PYTHON', 'python');
const DOTNET = envOr('LAB_DOTNET', 'dotnet');
const JAVA = envOr('LAB_JAVA', 'java');

export const ENGINES = [
  {
    id: 'go', language: 'Go', enabled: true,
    cmd: repo('chess-cordis', 'drivers', 'go', 'gochess_driver.exe'),
    args: [], timeout: 60000,
  },
  {
    id: 'rust', language: 'Rust', enabled: true,
    cmd: repo('chess-cordis', 'drivers', 'rust', 'target', 'release', 'rustchess_driver.exe'),
    args: [], timeout: 60000,
  },
  {
    id: 'vb', language: 'VB.NET', enabled: true,
    cmd: repo('chess-cordis', 'drivers', 'vb', 'VBChessDriver.exe'),
    args: [], timeout: 60000,
  },
  {
    id: 'ts', language: 'TypeScript', enabled: true,
    cmd: NODE,
    args: [repo('chess-cordis', 'drivers', 'ts', 'out', 'driver.cjs')],
    timeout: 60000,
  },
  {
    id: 'js', language: 'JavaScript', enabled: true,
    cmd: NODE,
    args: [repo('tournament', 'js_driver.mjs')],
    timeout: 60000,
  },
  {
    id: 'py', language: 'Python', enabled: true,
    cmd: PY,
    args: [repo('chess-cordis', 'drivers', 'py_engine_driver.py')],
    timeout: 180000, // python is the slowest by a wide margin
  },
  // ---- C++ : JSON-stdio driver prebuilt & verified (chess-cordis/drivers/cpp/) ----
  {
    id: 'cpp', language: 'C++', enabled: true,
    cmd: repo('chess-cordis', 'drivers', 'cpp', 'cppchess_driver.exe'),
    args: [], timeout: 60000,
  },
  // ---- C# / F# : need .NET 8 runtime (dotnet from PATH, or LAB_DOTNET) ----
  {
    id: 'cs', language: 'C#', enabled: true,
    cmd: DOTNET,
    args: [repo('chess-cordis', 'drivers', 'csharp', 'bin', 'Release', 'net8.0', 'ChessEngineDriver.dll')],
    timeout: 60000,
  },
  {
    id: 'fs', language: 'F#', enabled: true,
    cmd: DOTNET,
    args: [repo('chess-cordis', 'drivers', 'fsharp', 'bin', 'Release', 'net8.0', 'FSharpChessDriver.dll')],
    timeout: 60000,
  },
  // ---- Java : JDK 21 (java from PATH, or LAB_JAVA); JavaChess core compiled to out/ ----
  {
    id: 'java', language: 'Java', enabled: true,
    cmd: JAVA,
    args: ['-cp', repo('chess-cordis', 'drivers', 'java', 'out'), 'Driver'],
    timeout: 60000,
  },
];

// 可观测性：外部（probe.mjs / 排查脚本）能确认 local.env 到底有没有被读到、读到哪些键。
export { START_FEN, LOCAL_ENV_FILE, LOCAL_ENV };
