# . — 多语言国际象棋引擎移植实验场

> 10 种编程语言的功能对等国际象棋引擎 + 基于 [Cordis](https://cordis.js.org/) 的统一测试 harness（`chess-cordis`）。
> 权威架构与设计见 `chess-cordis/UNIFIED_ARCHITECTURE_REPORT.md`；依赖与运行环境见 `REQUIREMENTS.md`。

## 1. 这是什么

本仓库是一个**移植正确性研究实验场**：同一套国际象棋规则引擎 + negamax/quiescence 搜索，用 10 种语言各自独立实现为功能对等版本，再由 `chess-cordis` 把它们作为子进程统一驱动，做跨语言 perft 黄金值一致性验证与 bestMove 共识比对。

- 每个语言引擎：规则引擎 + AI 搜索 + **97 项核心自测**（8 种语言逐字一致）+ **perft 黄金断言**（`perft_spec.txt`），**零第三方依赖，仅用标准库**。
- `chess-cordis`：基于 Cordis 插件框架的统一 harness，通过 **JSON-stdio** 协议与各引擎子进程通信（**无网络监听面**）。

## 2. 仓库结构

| 路径 | 作用 |
|---|---|
| `CppChess/` `PyChess/` `CSharpChess/` `JavaChess/` `JsChess/` `TsChess/` `GoChess/` `RustChess/` `FSharpChess/` `VBChess/` | 10 个语言引擎（功能对等实现） |
| `chess-cordis/` | 统一 harness：Cordis 框架 + `drivers/<lang>/` 适配器 + `src/{host,stress,timing,harness,loader,registry,fen}` + `config/cordis.yml` |
| `tournament/` | 跨语言循环赛 runner：独立规则引擎（`engine.mjs`）+ JSON-stdio 客户端（`engine_client.mjs`）+ 引擎清单（`engines.mjs`）+ 战报生成（`run_tournament.mjs`）；由每日 03:00 的自动化任务驱动 |
| `cordis-main/` | **上游 Cordis 框架源码，仅本地溯源/重建 `chess-cordis` 用**，运行时**不加载**（用 npm 装的 `@cordisjs/cordis`）。**已 gitignore、本地保留、不推送**。 |
| `paper-main/` | 论文/设计参考（本地 gitignore，不推送） |
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

## 6. 各语言引擎单独跑自测（97 项核心 + perft 黄金断言）

| 语言 | 命令（在对应引擎目录执行） | 状态 |
|---|---|---|
| Python | `python main.py test` | ✅ **111/111**（2026-09-28 实测复跑：`111 passed, 0 failed`，7.0 秒） |
| JavaScript | `node main.js test` | ✅ **111/111**（2026-09-28 实测复跑：`111 passed, 0 failed`，1.1 秒） |
| C# | `dotnet run -- test` | ✅ 111/111 |
| Java | `javac -d out *.java && java -cp out Main test` | ✅ 111/111 |
| Go | `go run . test` | ✅ 111/111 |
| Rust | `cargo run --bin rustchess -- test` | ✅ 111/111 |
| TypeScript | `npx tsx main.ts test` | ✅ 111/111 |
| F# | 经由 harness 验证（无独立 `Tests.fs` 入口） | ✅ harness 内 10 引擎一致 |
| VB.NET | GUI 版（`ChessUI.vb`），无 headless 测试 | ⚠️ 仅 harness 验证 |
| C++ | `bash build_engines.sh` 重建 `cppchess_driver.exe`（需 MinGW-w64 g++） | ✅ harness + tournament 均验证（JSON-stdio driver 已构建） |

> 注：**97 项核心断言**在 8 种语言里**逐字一致**（由 `_parity.py` 校验）；
> 其上另有 **perft 黄金断言 14 条**（`perft_spec.txt` 契约：规范必需 5 条 + 各语言共同覆盖的 d1/d2 等），
> **8 种语言条数与命名完全一致**，合计 **111 项**。
> 更大的 `Kiwipete d4` / `Pos5 d4`（>2M 节点，慢）在 Python 与 Rust 里**以注释形式保留作参考**，不参与运行。
> `_parity.py` 会**先剥注释再统计**，因此"声明"与"实跑"一致。

## 7. 版本控制与构建

- 已 `git init`，`.gitignore` 排除二进制产物与本地草稿：
  - 二进制：`bin/ obj/ target/ out/ __pycache__/ node_modules/ *.exe *.dll *.so *.dylib`
  - 本地研究缓存（非交付物，仅本地保留）：`_archive/` `_removed_glue_archive/` `_mingw.nupkg` `cordis-main/` `paper-main/`
- **已推送到 Gitee**：远端 `https://gitee.com/siwpan/lab.git`（当前为**私有**仓库）。本地 **16 个提交 + 13 个 tag 全部已推送**（`git push origin master` + `git push origin --tags` 均已验证远端一致）。
  - tag 序列：<code>v0.1.0</code> → <code>harness-v1</code> → <code>engine-ports-v1</code> → <code>license-v1</code> → <code>tournament-v1</code> → <code>tournament-report-2026-09-28</code> → <code>tournament-parity-v1</code> → <code>spec-clarify-v1</code> → <code>engines-enable-cpp-cs-fs-v1</code> → <code>infra-build-v1</code> → <code>engines-enable-java-v1</code> → <code>docs-readme-v1</code> → <code>chore-gitignore-v1</code>。
  - 建仓与配 `origin` 用 allin 仓的 `tools/gitee_release.py`（`create` + `remote` 子命令）；转公开用其 `public` 子命令。
- **二进制产物不入仓**：cpp/cs/fs/java 的 `*.exe/*.dll/out/*.class` 被 `.gitignore` 忽略，克隆后需本地重建，见 §10。
- **本地参考克隆不入仓**：`cordis-main/`（Cordis 上游源码）、`paper-main/`（论文参考）仅本地保留、已 gitignore，用于溯源，运行时不需要。
- **许可证**：见 `LICENSE`（MIT）。

## 8. 注意事项

- **`cordis-main/` 本地保留但已 gitignore**：它是 `chess-cordis` 的上游溯源地基，**仅本地存在、不推送**（已加入 `.gitignore`），勿删除；其 `.github/` 工作流目录已剥离（第三方 CI 含 npm publish，误推送会触发）。
- 根目录旧报告（`CROSS_VALIDATION_REPORT.md` 等）已归档至 `_archive/`，以 `UNIFIED_ARCHITECTURE_REPORT.md` 为唯一权威。
- ~~`chess-cordis/config/cordis.yml` 与 `tournament/engines.mjs` 均含本机绝对路径~~ —— **2026-09-28 已修复**：两者均改为「仓内路径由脚本位置推导 + 工具走环境变量/PATH」，硬编码路径门禁由**阻断转为通过**（39 → 0）。

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

**工具链**：一律取 PATH；装在非标准位置时用环境变量覆盖（`LAB_DOTNET` / `LAB_JAVA` / `LAB_PYTHON` / `LAB_NODE` / `LAB_GPP` / `LAB_VCVARS` / `LAB_MINGW_DIR`）。

## 11. License

本仓库以 **MIT** 许可证发布，见 [`LICENSE`](./LICENSE)。
