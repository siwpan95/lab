# 国际象棋 VB.NET 框架（VBChess）

用 VB.NET（.NET Framework 4.x）实现的国际象棋框架，含**规则引擎 + AI 对弈引擎 + 图形界面**，
零第三方依赖、零外部资源，仅使用 Windows 自带的 `vbc.exe` 编译器即可完整构建。

## 目录结构

```
E:\lab\VBChess\
├── ChessCore.vb    规则引擎（棋盘/走法/终局判定，无 UI 依赖，可独立测试）
├── ChessAI.vb      AI 引擎（negamax + alpha-beta + PST 评估 + 静态搜索）
├── ChessUI.vb      图形界面（Windows Forms + GDI+，双人/人机模式）
├── ChessTests.vb   控制台自测（97 项断言）
├── build.bat       一键构建脚本（编译 GUI + 测试 + 自动跑测）
├── README.md       本文档
└── bin\                构建产物目录（已被 .gitignore 忽略，不入库；非源码，由 build.bat 生成）
    ├── VBChess.exe     图形界面主程序（构建后生成）
    └── ChessTests.exe  自测程序（构建后生成）
```

## 构建

双击 `build.bat`，或在命令行执行 `cd /d E:\lab\VBChess && build.bat`。
脚本自动完成：编译 GUI → 编译测试 → 运行 97 项自测 → 全绿输出 BUILD COMPLETE。

## 玩法

- **双人对弈**：默认模式，本地轮流走子
- **人机对弈**：右侧模式选择「执白」或「执黑」与 AI 对战
- **难度分级**：新手（搜索 1 层）/ 中级（2 层）/ 高级（3 层），中局深度 3 约 0.1 秒
- 点击己方棋子选中（绿格），合法走法以圆点（走子）/ 圆环（吃子）标出
- 兵升变弹四选一对话框；右侧面板有历史记录、悔棋（人机模式自动退两步）、新对局

## 架构说明

| 层次 | 文件 | 职责 |
|------|------|------|
| 数据层 | `ChessCore.vb / GameState` | 8×8 字符数组棋盘（mailbox）、行棋方、易位权、过路兵格、局面键历史 |
| 规则层 | `ChessCore.vb / Rules` | 伪合法走法生成 → 轻量副本试走 → `IsAttacked()` 过滤送王着法 |
| 终局层 | `ChessCore.vb / Rules` | 将军 / 将死 / 逼和 / 三次重复 / 50 步 / 子力不足 |
| 评估层 | `ChessAI.vb / AIEngine.Evaluate` | 子力价值（P100/N320/B330/R500/Q900）+ 位置价值表 PST（中心马、兵推进、王安全） |
| 搜索层 | `ChessAI.vb / AIEngine` | negamax + alpha-beta 剪枝 + MVV-LVA 走法排序 + 静态搜索 quiescence |
| 表现层 | `ChessUI.vb / MainForm` | GDI+ 绘制、鼠标交互、AI 后台线程（不卡 UI）、历史与悔棋 |

### AI 设计要点（参考轻量引擎通用方案）

1. **negamax + alpha-beta 剪枝**：无损剪枝，只提速不改变决策；终局评分
   将死 = ±900000（高于任意可能叶子评估，避免"贪子弃杀"；越快将死越优）、逼和 = 0
2. **评估函数**：Simplified Evaluation 标准数值——子力价值 + 每类棋子一张
   64 格位置价值表（PST），黑方取白方表行镜像；中心马加分、兵推进加分、
   王待底线安全
3. **走法排序（MVV-LVA）**：先吃大子、后用小子吃，大幅提升剪枝效率
4. **静态搜索（quiescence）**：叶子节点只延伸吃子着法（限深 4 层），
   消除深度截断造成的"水平线效应"
5. **性能路径**：搜索节点使用 `CloneLight()` 轻量克隆 +
   `ApplyMove(recordHistory:=False)` 跳过记谱/局面键，中局深度 3 约 126ms

### 规则层设计要点

1. **`IsAttacked()` 单一例程支撑整个规则库**：将军检测、易位路径安全、
   合法走法过滤全部复用同一"从目标格向外看"的攻击判定
2. **两阶段走法生成**：几何规则（偏移表 + 射线）生成伪合法走法，
   试走后检验王安全过滤——规则解耦、不易漏判
3. **三次重复判和**：局面键 = 棋盘 64 格 + 行棋方 + 易位权 + 过路兵格
   （ep 格仅在"存在合法吃过路兵"时才编码，符合 FEN 标准，避免无谓 ep 造成漏判），
   历史中出现 3 次即判和（悔棋快照机制自动回滚局面键历史）

## 规则与功能覆盖（97 项自测验证）

- 全六类棋子走法；兵双进、吃过路兵、四选一升变；王车易位（短/长，含路径安全约束）
- 将军、将死（学者杀/愚兄杀回归）、逼和、三次重复、50 步、子力不足
- **钉死棋子限制**：被钉死棋子无合法走法（如象被车钉死在线上）
- **逃将枚举**：被将军时所有合法走法均解除将军
- **过路兵揭开将军**：吃过路兵会暴露己方王时该吃子非法
- **子力不足扩展**：KNN / 异色格单象 / KBB 异色格双象可杀（不判和）/ KBN 可杀（不判和）
- AI：一步杀搜索（KQK 杀局）、无保护子捕获、开局合理着法、终局评分正确性、深度 3 性能
- 退化局面：空盘攻击判定、K vs K 王可走、将死局面 `FindBestMove = Nothing`、升变 SAN `e8=Q`

## v3 修复（gstack 上线前审查）

基于软件工坊 gstack 多成员审查报告（产品官 / 安全卫士 / 质量门神）执行的可落地修复：

| 严重度 | 修复项 | 说明 |
|--------|--------|------|
| P1 | AI 后台线程竞态 | 新增 `aiGeneration` 代次计数器；新对局/悔棋/切换模式自增，旧搜索回调 `OnAIDone` 比对代次后丢弃，杜绝"旧局面着法落到新棋局" |
| P1 | `FindBestMove` 返回类型 | 改为 `Move?`（Nullable），调用方用 `HasValue` 判空，消除值类型 `Equals(Nothing)` 永远为 False 的死检查 |
| P1 | 规则测试缺口 | 补钉死 / 逃将 / EP 揭开将军 / 子力不足扩展 / 深度 3 计时 等 27 项断言 |
| P2 | 贪子弃杀 | `MateScore` 由 9999 提到 900000（高于最大叶子评估） |
| P2 | 三次重复漏判 | 局面键仅在存在合法过路兵时编码 ep 格 |
| P2 | 健壮性 | 三文件加 `Option Strict On` + `Option Infer On`；`Move` 实现 `IEquatable(Of Move)`；`GetPST` 潜在 NRE 守卫 |
| P2 | 构建/分发 | `build.bat` 去除阻塞 CI 的 `pause`、标注目标框架；新增 `.gitignore` 排除 `bin/` |
| P3 | 死代码 | 移除未用 `LightSq` 字段与未用 `EvaluatePosition` 方法 |

## v4 发布前收口（非阻塞，gstack F-1 等）

合并 / 发布前需处理的三项（均为非阻塞），当前状态：

| 项 | 内容 | 状态 |
|----|------|------|
| AI 线程 epoch/abort 守卫（F-1, P2） | ① epoch：`aiGeneration` 代次计数器（v3 已加）丢弃过期回调；② abort：新增 `CancellationTokenSource`（`aiCts`），新对局/悔棋/切换模式时 `Cancel()` 真正中止在途后台线程，搜索各层检查 `IsCancellationRequested` 并抛出 → `FindBestMove` 捕获返回 `Nothing`。epoch + abort 双保险 | ✅ 已完成 |
| `bin/` 加入 .gitignore（移除源码中的预编译二进制） | `.gitignore` 已在 v3 排除 `bin/`；v4 进一步物理删除 `bin/VBChess.exe`、`bin/ChessTests.exe`（可经 `build.bat` 重建，永不入库） | ✅ 已完成 |
| 正式发布前用受信 CA 证书重新签名 | 本机仅有自签名证书（仅本机信任），分发他机仍触发 SmartScreen；需受信 CA 代码签名证书。本机无证书，**无法执行**，发布前必做 | ⏳ 待发布执行（见下） |

### 发布前必做：受信 CA 重签

自签名证书仅在本机受信，分发到其他机器仍会触发 SmartScreen 拦截。正式发布前须用受信 CA（如 DigiCert / Sectigo / 国内 CA）签发的代码签名证书，
并结合 RFC3161 时间戳服务器完成签名（时间戳确保证书过期后签名仍有效）：

```bat
REM 1) 用受信 CA 证书签名（含 SHA256 时间戳）
signtool sign /fd sha256 /td sha256 /tr http://timestamp.digicert.com bin\VBChess.exe
signtool sign /fd sha256 /td sha256 /tr http://timestamp.digicert.com bin\ChessTests.exe

REM 2) 校验签名与时间戳
signtool verify /pa /tp 1 bin\VBChess.exe
```

> 说明：`signtool` 随 Windows SDK / Visual Studio 安装；`/tr` 后为 RFC3161 时间戳 URL（示例为 DigiCert，
> 可替换为所用 CA 提供的时间戳地址）。EV 代码签名证书可进一步消除 SmartScreen 信誉冷却期。

## 扩展方向

- 迭代加深 + 置换表（Zobrist 哈希）：同时间内搜索更深
- 完整 SAN 记谱（同型棋子消歧）+ PGN 导出
- 残局王 PST 切换（中局/残局两套王位置表）
- 棋盘翻转、音效、走子动画
- `Move` 结构进一步改为只读字段 + 构造函数（当前为可变字段 + 已实现 IEquatable）
