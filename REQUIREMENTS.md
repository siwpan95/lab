# Requirements（运行环境 / 依赖需求）

> 配套 `README.md`。本仓库是**多语言**项目，**没有单一的 `requirements.txt` 能覆盖全部**；下方按层级列出真实依赖。

## 1. 依赖总览

| 组件 | 依赖类型 | 说明 |
|---|---|---|
| 10 个语言引擎 | **零第三方依赖**（纯标准库） | 每个引擎只用语言自带标准库 |
| `chess-cordis`（harness） | Node.js + npm 包 | 唯一有包依赖的部分 |
| `cordis-main` | 无（仅源码溯源） | 不参与运行 |

## 2. 运行时 / 工具链需求

| 需求 | 版本 / 说明 | 用途 |
|---|---|---|
| Node.js | ≥ 20（host.js / stress.js 用 ESM） | 运行 harness |
| Python | 3.14+ | PyChess 引擎 + py 驱动 |
| .NET 8 SDK | `dotnet` | C# 驱动（net8.0）、F# 驱动（net8.0） |
| .NET Framework 4.x + `vbc` | Windows | VB.NET 驱动（`VBChessDriver.exe`） |
| Java（JDK / JBR） | 11+ | Java 驱动 |
| Go | 1.2x | Go 驱动 |
| Rust + Cargo | stable | Rust 驱动 |
| MinGW-w64 `g++` | 含静态链接支持 | C++ 驱动（`g++.exe -static`） |
| TypeScript + esbuild | `tsc` 仅类型检查，`esbuild` 打包 driver | TS 驱动（`out/driver.cjs`） |

> ⚠️ 本机重工具装在 `F:\` 盘（如 Python、.NET、MinGW-w64、Go、Rust 工具链）。这些**不是仓库要求**，仅说明若工具链不在 `PATH` 上需手动定位（旧报告曾因此误判"缺工具链"）。

## 3. chess-cordis 的 npm 依赖

`chess-cordis/package.json`：

```json
"dependencies": {
  "@standard-schema/spec": "^1.1.0",
  "cosmokit": "^1.8.1",
  "js-yaml": "^5.4.1",
  "typescript": "^5.9.3"
},
"devDependencies": {
  "esbuild": "^0.28.0"
}
```

（运行时实际消费 `@cordisjs/cordis` 等，由上述依赖拉起；`@standard-schema/spec` 为 schema 接口。）

安装：

```bash
cd chess-cordis
npm install
```

## 4. 引擎驱动的构建（harness 用）

harness 直接调用预构建的驱动产物。若需重建：

| 驱动 | 构建命令（在 `chess-cordis/drivers/<lang>/`） |
|---|---|
| cpp | `g++.exe -static driver.cpp <链接 CppChess core> -o cppchess_driver.exe` |
| csharp | `dotnet build -c Release` → `bin/Release/net8.0/ChessEngineDriver.dll` |
| fsharp | `dotnet build -c Release` → `bin/Release/net8.0/FSharpChessDriver.dll` |
| go | `go build -o gochess_driver.exe .` |
| rust | `cargo build --release` → `target/release/rustchess_driver.exe` |
| java | `javac -d out Driver.java <+ JavaChess core>` |
| ts | `esbuild driver.ts --bundle --platform=node --outfile=out/driver.cjs` |
| py | 无需构建（`py_engine_driver.py` 直接运行，sys.path 注入 `PyChess`） |
| vb | `vbc /target:exe /out:VBChessDriver.exe Driver.vb` |

## 5. 验证环境（本机已复验）

- OS：Windows 11 (win32)
- 上述全部运行时可用；`git` 已初始化。
- 端到端复验：`node src/host.js` / `node src/stress.js` 均 exit code 0，10 引擎 golden perft 一致。

## 6. Python 部分是否需要 `pip install`？

不需要。`PyChess` 引擎与 `py_engine_driver.py` 均为零依赖纯标准库实现，无需 `pip install` 任何包。若你只想单独跑 Python 引擎：

```bash
cd PyChess
python main.py test      # 97 项自测 + perft 黄金断言（110/111，1 项性能断言除外）
```
