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
// 需要覆盖时（例如工具链装在非 PATH 位置）：
//   LAB_NODE / LAB_PYTHON / LAB_DOTNET / LAB_JAVA
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/tournament
const ROOT = dirname(HERE);                            // <repo>
/** 仓内路径：repo('chess-cordis', 'drivers', ...) */
const repo = (...p) => join(ROOT, ...p);

const NODE = process.env.LAB_NODE || process.execPath;
const PY = process.env.LAB_PYTHON || 'python';
const DOTNET = process.env.LAB_DOTNET || 'dotnet';
const JAVA = process.env.LAB_JAVA || 'java';

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

export { START_FEN };
