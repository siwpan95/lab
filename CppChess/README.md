# 国际象棋 C++ 版（CppChess）

与同目录 `VBChess/`（VB.NET 版）功能对等的 **C++17 移植**：同样的规则引擎 + AI 对弈引擎
+ 控制台对弈/自对弈/计时入口 + 一套对齐 VB 版 97 项断言的自测。零第三方依赖、零外部
资源，仅需一个支持 C++17 的编译器（MinGW-w64 `g++` / MSVC / Clang 均可）。

> 移植说明（含联网调研结论）：经典国际象棋引擎最主流的棋盘表示有三类——
> **mailbox 8×8 数组**、**0x88**、**bitboard（位棋盘）**。bitboard 性能最佳但实现复杂
> （需魔法位棋盘/旋转位棋盘），0x88 适合无 64 位指令的平台。本版与 VB 版保持
> **mailbox 8×8 字符数组** 方案，零依赖、易对齐、规则正确性优先；如需极致性能可后续
> 单独迁移到 bitboard（参考 Chess Programming Wiki / yvl-chess / Stockfish）。

## 目录结构

```
E:\lab\CppChess\
├── chess_core.h    规则引擎（棋盘/走法/终局判定，无 UI 依赖，可独立测试）
├── chess_core.cpp  规则引擎实现（对齐 VBChess/ChessCore.vb）
├── chess_ai.h      AI 引擎声明（negamax + alpha-beta + PST + 静态搜索）
├── chess_ai.cpp    AI 引擎实现（对齐 VBChess/ChessAI.vb）
├── tests.cpp       控制台自测（97 项断言，对齐 ChessTests.vb）
├── main.cpp        入口：test / selfplay / bench / play 子命令
├── CMakeLists.txt  CMake 构建（可选）
├── build.bat       一键构建脚本（编译 + 自动跑测，g++/MSVC 双编译器自动探测，优先 F:\VS2022）
├── .gitignore      排除 bin/ 等构建产物
├── README.md       本文档
└── bin\                构建产物目录（已被 .gitignore 忽略）
    └── cppchess.exe    控制台主程序（构建后生成）
```

## 构建

`build.bat` 采用 **g++ / MSVC 双编译器自动探测**，无需手动配置环境：

1. **优先 g++（MinGW-w64）**：依次探测 `PATH` → `C:\tools\mingw64` → `C:\ProgramData\chocolatey\bin` → `C:\msys64\mingw64\bin` → `E:\mingw64\bin`
2. **g++ 未找到时自动切 MSVC**：通过 `vcvars64.bat` 初始化 MSVC 环境后再用 `cl` 编译
   - 按显式候选探测，**`F:\VS2022` 排第一**（你指定的安装盘，避开 C 盘空间压力），另有
     `F:\VS2022Community`、`F:\VisualStudio2022` 与标准 C: 路径
     （Community / Professional / Enterprise）兜底
   - 注：脚本为规避 cmd 的 `(x86)` 括号解析陷阱（会把 `(x86)` 的 `)` 误判为代码块结束），
     **不使用 `for` 列表、不内联 `(x86)` 路径、注释与代码均零括号**，全部用 `goto` 标签控制流程。
     若 VS 装在其它盘，直接在 `build.bat` 的候选段加一行 `if not defined VCVARS if exist "X:\...\vcvars64.bat" set "VCVARS=..."` 即可。

**方式 A — build.bat（推荐，Windows）**
双击 `build.bat`，或在命令行执行 `cd /d E:\lab\CppChess && build.bat`。
脚本自动完成：探测编译器（g++ 或 MSVC）→ 编译 `cppchess.exe` → 运行 97 项自测 → 全绿输出 BUILD COMPLETE。

> - 本机无预装编译器时，可用便携 MinGW-w64：解压到 `E:\mingw64`（`E:\mingw64\bin\g++.exe`），
>   build.bat 会自动识别。
> - 已装 **Visual Studio（含「使用 C++ 的桌面开发」）到 `F:\VS2022`** 时，build.bat 自动找到
>   `F:\VS2022\VC\Auxiliary\Build\vcvars64.bat` 并初始化环境，无需手动配 PATH；装到其它盘也会被
>   `vswhere` 动态搜到。

**方式 B — 手动 g++**
```bat
g++ -std=c++17 -O2 -o bin\cppchess.exe main.cpp chess_core.cpp chess_ai.cpp tests.cpp
bin\cppchess.exe test
```

**方式 C — 手动 MSVC（cl）**
```bat
call "F:\VS2022\VC\Auxiliary\Build\vcvars64.bat"
cl /std:c++17 /O2 /EHsc /utf-8 /nologo /Fobin\ /Fe:bin\cppchess.exe main.cpp chess_core.cpp chess_ai.cpp tests.cpp
bin\cppchess.exe test
```

**方式 D — CMake**
```bat
cmake -S . -B build && cmake --build build
.\build\cppchess.exe test
```

## 用法

| 命令 | 说明 |
|------|------|
| `cppchess` 或 `cppchess test` | 运行 97 项规则/AI 自测，全绿返回 0 |
| `cppchess selfplay N D` | AI(白) vs AI(黑) 各走 N 步，搜索深度 D，演示对弈推进 |
| `cppchess bench D` | 从初始局面做 `FindBestMove` 计时（深度 D） |
| `cppchess play` | 文本交互双人对弈，走法如 `e2e4`，升变自动选后 |
| `cppchess play ai` | 文本交互：人类执白、AI（黑）接手（默认深度 2） |

## 架构说明

| 层次 | 文件 | 职责 |
|------|------|------|
| 数据层 | `chess_core.h / GameState` | 8×8 字符数组棋盘（mailbox）、行棋方、易位权、过路兵格、局面键历史 |
| 规则层 | `chess_core.cpp / Rules` | 伪合法走法生成 → 轻量副本试走 → `IsAttacked()` 过滤送王着法 |
| 终局层 | `chess_core.cpp / Rules` | 将军 / 将死 / 逼和 / 三次重复 / 50 步 / 子力不足 |
| 评估层 | `chess_ai.cpp / AIEngine::Evaluate` | 子力价值（P100/N320/B330/R500/Q900）+ 位置价值表 PST |
| 搜索层 | `chess_ai.cpp / AIEngine` | negamax + alpha-beta 剪枝 + MVV-LVA 走法排序 + 静态搜索 quiescence |
| 表现层 | `main.cpp` | 控制台交互动 / 自对弈 / 计时 / 自测入口 |

### AI 设计要点（与 VB 版一致，参考轻量引擎通用方案）

1. **negamax + alpha-beta 剪枝**：无损剪枝，只提速不改变决策；终局评分
   将死 = ±900000（高于任意可能叶子评估，避免“贪子弃杀”；越快将死越优）、逼和 = 0
2. **评估函数**：子力价值 + 每类棋子一张 64 格位置价值表（PST），黑方取白方表行镜像；
   中心马加分、兵推进加分、王待底线安全
3. **走法排序（MVV-LVA）**：先吃大子、后用小子吃，提升剪枝效率
4. **静态搜索（quiescence）**：叶子节点只延伸吃子着法（限深 4 层），消除水平线效应
5. **性能路径**：搜索节点使用 `CloneLight()` 轻量克隆 + `ApplyMove(recordHistory=false)`
   跳过记谱/局面键拷贝

### 规则层设计要点（与 VB 版一致）

1. **`IsAttacked()` 单一例程支撑整个规则库**：将军检测、易位路径安全、合法走法过滤
   全部复用同一“从目标格向外看”的攻击判定
2. **两阶段走法生成**：几何规则（偏移表 + 射线）生成伪合法走法，试走后检验王安全过滤
3. **三次重复判和**：局面键 = 棋盘 64 格 + 行棋方 + 易位权 + 过路兵格
   （ep 格仅在“存在合法吃过路兵”时才编码，符合 FEN 标准），历史中出现 3 次即判和

## 规则与功能覆盖（97 项自测验证）

- 全六类棋子走法；兵双进、吃过路兵、四选一升变；王车易位（短/长，含路径安全约束）
- 将军、将死（学者杀/愚兄杀回归）、逼和、三次重复、50 步、子力不足
- **钉死棋子限制**：被钉死棋子无合法走法（如象被车钉死在线上）
- **逃将枚举**：被将军时所有合法走法均解除将军
- **过路兵揭开将军**：吃过路兵会暴露己方王时该吃子非法
- **子力不足扩展**：KNN / 异色格单象 / KBB 异色格双象可杀（不判和）/ KBN 可杀（不判和）
- AI：一步杀搜索（KQK 杀局）、无保护子捕获、开局合理着法、终局评分正确性、深度 3 性能
- 退化局面：空盘攻击判定、K vs K 王可走、将死局面 `FindBestMove` 无值、升变 SAN `e8=Q`

## 与 VB 版的差异

| 维度 | VB 版 (VBChess) | C++ 版 (CppChess) |
|------|-----------------|-------------------|
| 界面 | Windows Forms + GDI+ 图形界面 | 文本控制台（play / selfplay / bench / test） |
| 线程 | AI 后台线程 + 代次/取消保护 | 同步搜索（控制台无 UI 卡顿问题） |
| 平台 | .NET Framework 4.x + `vbc.exe` | C++17，任意含 C++17 编译器平台 |
| 目标 | 交互式图形对弈 | 规则正确性验证 + 可嵌入的引擎库 + 命令行对弈 |

> C++ 版的 `chess_core.h/.cpp` 与 `chess_ai.h/.cpp` 是**与平台无关的头/实现**，
> 可直接作为引擎库嵌入到其它 C++ 项目（如后续做跨平台 GUI、UCI 协议封装等）。

## 扩展方向

- 迭代加深 + 置换表（Zobrist 哈希）：同时间内搜索更深
- 完整 SAN 记谱（同型棋子消歧）+ PGN 导出
- 残局王 PST 切换（中局/残局两套王位置表）
- bitboard 棋盘表示迁移以获得更强性能
- UCI 协议封装（接驳棋软/在线对弈）
