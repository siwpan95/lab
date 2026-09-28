# D:/projects/lab — 多语言国际象棋引擎移植实验场

> 10 种编程语言的功能对等国际象棋引擎 + 基于 [Cordis](https://cordis.js.org/) 的统一测试 harness（`chess-cordis`）。
> 权威架构与设计见 `chess-cordis/UNIFIED_ARCHITECTURE_REPORT.md`；依赖与运行环境见 `REQUIREMENTS.md`。

## 1. 这是什么

本仓库是一个**移植正确性研究实验场**：同一套国际象棋规则引擎 + negamax/quiescence 搜索，用 10 种语言各自独立实现为功能对等版本，再由 `chess-cordis` 把它们作为子进程统一驱动，做跨语言 perft 黄金值一致性验证与 bestMove 共识比对。

- 每个语言引擎：规则引擎 + AI 搜索 + 97 项自测（含 perft 黄金断言），**零第三方依赖，仅用标准库**。
- `chess-cordis`：基于 Cordis 插件框架的统一 harness，通过 **JSON-stdio** 协议与各引擎子进程通信（**无网络监听面**）。

## 2. 仓库结构

| 路径 | 作用 |
|---|---|
| `CppChess/` `PyChess/` `CSharpChess/` `JavaChess/` `JsChess/` `TsChess/` `GoChess/` `RustChess/` `FSharpChess/` `VBChess/` | 10 个语言引擎（功能对等实现） |
| `chess-cordis/` | 统一 harness：Cordis 框架 + `drivers/<lang>/` 适配器 + `src/{host,stress,timing,harness,loader,registry,fen}` + `config/cordis.yml` |
| `tournament/` | 跨语言循环赛 runner：独立规则引擎（`engine.mjs`）+ JSON-stdio 客户端（`engine_client.mjs`）+ 引擎清单（`engines.mjs`）+ 战报生成（`run_tournament.mjs`）；由每日 03:00 的自动化任务驱动 |
| `cordis-main/` | **上游 Cordis 框架源码，仅用于溯源/重建 `chess-cordis` 依赖**，运行时**不加载**（运行时用 npm 安装的 `@cordisjs/cordis`）。**保留此目录，不要删除**。 |
| `paper-main/` | 论文/设计占位（空壳） |
| `_archive/` | 已被 `UNIFIED_ARCHITECTURE_REPORT.md` 取代的旧报告归档 |
| `port_spec.txt` | 移植规范（单一真相来源） |
| `perft_spec.txt` | perft 黄金值契约 |

## 3. 架构（harness）

```
host.js ──▶ Cordis Service
              ├─ registry / loader   (读 config/cordis.yml)
              └─ 每个引擎一个 EnginePlugin
                    └─ engine-subprocess ─ spawn ─▶ drivers/<lang>/<driver>   (JSON-stdio)
```

- **驱动模型**：每种语言在 `chess-cordis/drivers/<lang>/` 有一个 harness 适配器（C++/Go/Rust 编译为 `.exe`；C#/F# 为 `.dll`；Java 为 `out/`；TS 为 esbuild 打包的 `driver.cjs`；Python 为 `py_engine_driver.py`；VB 为 `.exe`）。
- **协议**：子进程读 stdin 的 JSON 指令、写 stdout 的 JSON 结果。**无 HTTP / socket 监听**。
- **配置**：`config/cordis.yml` 注册 10 个引擎（`enabled` / `language` / `cmd` / `timeout` 等）。⚠️ 当前文件含本机绝对路径，换机需调整。

## 4. 快速开始（harness 统一入口）

前置依赖见 `REQUIREMENTS.md`。

```bash
cd chess-cordis
npm install            # 首次需安装 Cordis 等依赖（node_modules 已就绪可跳过）
node src/host.js      # 加载 10 引擎 + 7 个 golden perft 一致性 + bestMove 共识
node src/stress.js    # 基线加载 + 热插拔（py 子进程 kill / js 原生热插拔）
node src/timing.js    # 10 引擎权威 timing 基准（Start / Kiwipete d4）
```

## 5. 验证状态（已端到端复验，exit code 0）

- **10 引擎全部 `enabled: true`**，均成功加载。
- **7 个 golden perft 位置，10 引擎节点数完全一致**（Start d3/d4、Kiwipete d2/d3、Wiki3 d3/d4、Wiki5 d3）。
- **bestMove 共识**：FreeQueen `d1d5`、FreeRook `d1d4` 全引擎一致。
- **已知分歧（非缺陷）**：Start d2（depth-2，eval-invariant=false，无唯一最优解）F#/VB/CPP 选不同走法，属预期分歧。
- **已修复项**：C++ driver FEN 越界写（CWE-787）已加边界守卫；F# `evaluate()` 已补 6 张 PST。
- 详见 `chess-cordis/UNIFIED_ARCHITECTURE_REPORT.md` §9.6。

## 6. 各语言引擎单独跑 97 项自测

| 语言 | 命令（在对应引擎目录执行） | 状态 |
|---|---|---|
| Python | `python main.py test` | ✅ 110/111（唯一失败为 CPython 深度3 搜索耗时性能断言，非逻辑错误） |
| JavaScript | `node main.js test` | ✅ 111/111 |
| C# | `dotnet run -- test` | ✅ 111/111 |
| Java | `javac -d out *.java && java -cp out Main test` | ✅ 111/111 |
| Go | `go run . test` | ✅ 111/111 |
| Rust | `cargo run --bin rustchess -- test` | ✅ 111/111 |
| TypeScript | `npx tsx main.ts test` | ✅ 111/111 |
| F# | 经由 harness 验证（无独立 `Tests.fs` 入口） | ✅ harness 内 10 引擎一致 |
| VB.NET | GUI 版（`ChessUI.vb`），无 headless 测试 | ⚠️ 仅 harness 验证 |
| C++ | `bash build_engines.sh` 重建 `cppchess_driver.exe`（需 MinGW-w64 g++） | ✅ harness + tournament 均验证（JSON-stdio driver 已构建） |

> 注：97 项自测含 perft 黄金断言，与 `perft_spec.txt` 契约一致。

## 7. 版本控制与构建

- 已 `git init` 并写入 `.gitignore`（排除 `bin/ obj/ target/ out/ __pycache__/ node_modules/ *.exe *.dll` 等二进制产物）。
- **本地提交已完成**：10 个逻辑提交 + 10 个 tag，全部 **仅本地、未推送**（推送用 `D:/projects/allin/tools/gitee_release.py`）。
  - `v0.1.0`（元信息/规范）→ `harness-v1` → `engine-ports-v1` → `tournament-v1` → `tournament-report-2026-09-28` → `tournament-parity-v1` → `chore-gitignore-v1` → `spec-clarify-v1` → `engines-enable-cpp-cs-fs-v1` → `engines-enable-java-v1`。
- **二进制产物不入仓**：cpp/cs/fs/java 的 `*.exe/*.dll/out/*.class` 被 `.gitignore` 忽略，克隆后需本地重建，见 §10。
- **许可证**：见 `LICENSE`（MIT）。

## 8. 注意事项

- **`cordis-main/` 保留**：它是 `chess-cordis` 的上游溯源地基，勿删除；仅其 `.github/` 工作流目录已剥离（第三方 CI 含 npm publish，误推送会触发）。
- 根目录旧报告（`CROSS_VALIDATION_REPORT.md` 等）已归档至 `_archive/`，以 `UNIFIED_ARCHITECTURE_REPORT.md` 为唯一权威。
- `chess-cordis/config/cordis.yml` 与 `tournament/engines.mjs` 均含本机绝对路径（如 `D:/dotnet8`、`D:/jdk21`、`D:/projects/lab/...`）。换机/换用户须改为相对路径或环境变量；原文档中 `F:/mingw64`、`F:/dotnet` 等 F 盘引用已失效（本机已无 F 盘）。

---

## 9. 跨语言循环赛（tournament/）

`tournament/` 是一套**独立的**跨语言循环赛系统（不依赖 Cordis）：

- `engine.mjs` —— 独立纯 JS 规则引擎（perft 黄金值 5/5 通过，`applyUci` 对非法走法抛错），作为**权威裁决层**。
- `engine_client.mjs` —— JSON-stdio 子进程客户端（spawn + `ready` 守卫 + 带超时 rpc）。
- `engines.mjs` —— 10 引擎清单（`enabled` / `language` / `cmd` / `timeout`）。
- `run_tournament.mjs` —— 循环赛主逻辑：探测 → 对局 → `applyUci` 校验 → 终局判定 → 积分 → 写 Markdown 战报。
- `probe.mjs` —— 开局探测（确认每个引擎能返回合法 JSON）。

**运行**：

```bash
cd tournament
node probe.mjs                                  # 确认 10 引擎全绿
node run_tournament.mjs                         # 默认 depth=3，生成 reports/YYYY-MM-DD.md
TOURNAMENT_DEPTH=4 node run_tournament.mjs      # 更深的搜索（更慢）
ENGINES_FILTER=go,rust,py node run_tournament.mjs   # 只跑子集冒烟
```

环境变量：`TOURNAMENT_DEPTH`（默认 3）、`GAMES_PER_PAIR`（默认 2）、`ENGINES_FILTER`（逗号分隔子集）。
引擎崩溃/超时/非法着法 → 该局判负并 kill，后续该引擎对局判不战而胜，**保证有界不挂死**。

**自动化**：每日 03:00 由 recurring automation 自动跑 `TOURNAMENT_DEPTH=4 node run_tournament.mjs` 并生成当日战报。

## 10. 构建编译型引擎产物（build_engines.sh）

二进制产物被 `.gitignore` 忽略、不入库，克隆到新机后运行本脚本重建：

```bash
./build_engines.sh            # 构建全部（C++ 缺编译器时仅告警跳过）
./build_engines.sh --verify   # 构建后额外跑 tournament/probe.mjs
```

脚本只重建 `tournament/engines.mjs` 实际消费的产物：

| 引擎 | 产物 | 工具链 |
|---|---|---|
| C++ | `chess-cordis/drivers/cpp/cppchess_driver.exe` | MinGW-w64 `g++`（缺省时跳过并提示） |
| C# | `chess-cordis/drivers/csharp/bin/Release/net8.0/ChessEngineDriver.dll` | .NET 8 **SDK** |
| F# | `chess-cordis/drivers/fsharp/bin/Release/net8.0/FSharpChessDriver.dll` | .NET 8 **SDK** |
| Java | `chess-cordis/drivers/java/out/*.class` | JDK 21 `javac` |

纯解释型引擎（go/rust/vb/ts/js/py）无需本脚本。

**本机工具链位置**（可经环境变量覆盖）：`D:/dotnet8`（.NET 8 SDK，含 runtime）、`D:/jdk21`（JDK 21）、`E:/mingw64`（MinGW-w64 GCC，C++ driver 构建）。换机时分别用 `DOTNET=` / `JAVAC=` / `CXX=` 覆盖。

## 11. License

本仓库以 **MIT** 许可证发布，见 [`LICENSE`](./LICENSE)。
