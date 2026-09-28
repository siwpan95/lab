# E:\lab — 多语言国际象棋引擎移植实验场

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
| C++ | 用户指定暂不实跑（harness driver 已构建验证） | ⏸ 跳过 |

> 注：97 项自测含 perft 黄金断言，与 `perft_spec.txt` 契约一致。

## 7. 版本控制

- 已 `git init` 并写入 `.gitignore`（排除 `bin/ obj/ target/ out/ __pycache__/ node_modules/ *.exe *.dll`）。
- 尚未批量提交，按需 `git add` / `git commit`。

## 8. 注意事项

- **`cordis-main/` 保留**：它是 `chess-cordis` 的上游溯源地基，勿删除；仅其 `.github/` 工作流目录已剥离（第三方 CI 含 npm publish，误推送会触发）。
- 根目录旧报告（`CROSS_VALIDATION_REPORT.md` 等）已归档至 `_archive/`，以 `UNIFIED_ARCHITECTURE_REPORT.md` 为唯一权威。
- `chess-cordis/config/cordis.yml` 含本机绝对路径（如 `F:/mingw64`、`F:/dotnet`），换机/换用户须改为相对路径或环境变量。
