// tournament/engines.mjs
// Engine manifest for the cross-language tournament. Paths are corrected for the
// current machine (the legacy cordis.yml still points at the removed E:/lab and
// F:/ volumes). Each entry is a JSON-stdio driver the EngineClient can spawn.
//
// The runner PROBES every enabled engine at startup; only engines that actually
// answer join the bracket. Engines marked `disabled` are skipped outright and
// noted in the report (no fake results, no wasted startup time).
//
// Participating (enabled, verified to run on this machine):
//   go, rust, vb, ts, js, py  — original 6 (no extra runtime needed)
//   cpp, cs, fs              — enabled 2026-09-28 after .NET 8 runtime install
//                                (D:/dotnet8) + cpp JSON-stdio driver verified
//   java                     — being enabled 2026-09-28 after JDK 21 install
//
// Previously disabled (now resolved):
//   cpp  — was "excluded by user decision"; the JSON-stdio driver
//          (chess-cordis/drivers/cpp/cppchess_driver.exe) is prebuilt & verified.
//   cs/fs — needed .NET 8 runtime; only Microsoft.NETCore.App 6.0.8 was present.
//   java — no java.exe runtime on this machine.
//
// `depth` is the per-move search depth (user-selected strength = 3; the daily
// automation overrides it to 4).
// `timeout` is the per-move RPC ceiling; python is slow → generous one.

import { START_FEN } from './engine_client.mjs';

export const TOURNAMENT_DEPTH = 3; // user-selected strength
export const MAX_PLY = 160;        // hard cap on half-moves per game (draw if exceeded)
export const GAMES_PER_PAIR = 2;   // swap colors

const NODE = 'C:/Users/13122/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const PY = 'C:/Users/13122/.workbuddy/binaries/python/versions/3.13.12/python.exe';

export const ENGINES = [
  {
    id: 'go', language: 'Go', enabled: true,
    cmd: 'D:/projects/lab/chess-cordis/drivers/go/gochess_driver.exe',
    args: [], timeout: 60000,
  },
  {
    id: 'rust', language: 'Rust', enabled: true,
    cmd: 'D:/projects/lab/chess-cordis/drivers/rust/target/release/rustchess_driver.exe',
    args: [], timeout: 60000,
  },
  {
    id: 'vb', language: 'VB.NET', enabled: true,
    cmd: 'D:/projects/lab/chess-cordis/drivers/vb/VBChessDriver.exe',
    args: [], timeout: 60000,
  },
  {
    id: 'ts', language: 'TypeScript', enabled: true,
    cmd: NODE,
    args: ['D:/projects/lab/chess-cordis/drivers/ts/out/driver.cjs'],
    timeout: 60000,
  },
  {
    id: 'js', language: 'JavaScript', enabled: true,
    cmd: NODE,
    args: ['D:/projects/lab/tournament/js_driver.mjs'],
    timeout: 60000,
  },
  {
    id: 'py', language: 'Python', enabled: true,
    cmd: PY,
    args: ['D:/projects/lab/chess-cordis/drivers/py_engine_driver.py'],
    timeout: 180000, // python is the slowest by a wide margin
  },
  // ---- C++ : JSON-stdio driver prebuilt & verified (chess-cordis/drivers/cpp/) ----
  {
    id: 'cpp', language: 'C++', enabled: true,
    cmd: 'D:/projects/lab/chess-cordis/drivers/cpp/cppchess_driver.exe',
    args: [], timeout: 60000,
  },
  // ---- C# / F# : need .NET 8 runtime (installed at D:/dotnet8) ----
  {
    id: 'cs', language: 'C#', enabled: true,
    cmd: 'D:/dotnet8/dotnet.exe',
    args: ['D:/projects/lab/chess-cordis/drivers/csharp/bin/Release/net8.0/ChessEngineDriver.dll'],
    timeout: 60000,
  },
  {
    id: 'fs', language: 'F#', enabled: true,
    cmd: 'D:/dotnet8/dotnet.exe',
    args: ['D:/projects/lab/chess-cordis/drivers/fsharp/bin/Release/net8.0/FSharpChessDriver.dll'],
    timeout: 60000,
  },
  // ---- Java : JDK 21 installing at D:/jdk21; enable after java.exe path confirmed ----
  {
    id: 'java', language: 'Java', enabled: false,
    disabledReason: 'JDK 21 installing at D:/jdk21; out/Driver.class must be compiled',
  },
];

export { START_FEN };
