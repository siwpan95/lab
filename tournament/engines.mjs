// tournament/engines.mjs
// Engine manifest for the cross-language tournament. Paths are corrected for the
// current machine (the legacy cordis.yml still points at the removed E:/lab and
// F:/ volumes). Each entry is a JSON-stdio driver the EngineClient can spawn.
//
// The runner PROBES every enabled engine at startup; only engines that actually
// answer join the bracket. Engines marked `disabled` are skipped outright and
// noted in the report (no fake results, no wasted startup time).
//
// Participating (enabled, expected to run on this machine):
//   go, rust, vb, ts, py, js
// Disabled (with reason):
//   cpp  — excluded by user decision (its .exe is present but parked)
//   cs   — needs .NET 8 runtime; only Microsoft.NETCore.App 6.0.8 is installed
//   fs   — needs .NET 8 runtime; only 6.0.8 is installed
//   java — no java.exe runtime on this machine
//
// `depth` is the per-move search depth (user-selected strength = 3).
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
  // ---- disabled on this machine ----
  {
    id: 'cpp', language: 'C++', enabled: false,
    disabledReason: 'excluded by user decision (its .exe is present but parked)',
  },
  {
    id: 'cs', language: 'C#', enabled: false,
    disabledReason: 'needs .NET 8 runtime; only Microsoft.NETCore.App 6.0.8 installed here',
  },
  {
    id: 'fs', language: 'F#', enabled: false,
    disabledReason: 'needs .NET 8 runtime; only Microsoft.NETCore.App 6.0.8 installed here',
  },
  {
    id: 'java', language: 'Java', enabled: false,
    disabledReason: 'no java.exe runtime on this machine',
  },
];

export { START_FEN };
