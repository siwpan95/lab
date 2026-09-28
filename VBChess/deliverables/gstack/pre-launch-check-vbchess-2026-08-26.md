# VBChess 上线前全检报告

**日期**：2026-08-26
**场景**：上线前检查（代码审查 + 安全审计 + QA测试）
**参与成员**：软件工坊主理人（编排） + 产品官（代码审查） + 安全卫士（OWASP+STRIDE 审计） + 质量门神（QA测试与发布）
**项目**：E:\lab\VBChess — VB.NET (.NET Framework 4.x) 国际象棋框架（规则引擎 + AI + Windows Forms GUI），纯本地、零第三方依赖、零网络/DB/文件 IO。

---

## 📌 TL;DR（执行摘要，3-5 行）
- 整体结论：🟡 有条件通过（Conditional Go）—— 无阻断上线的 P0，可在合并/发布前补齐 P1 测试与两项卫生项后放行。
- 实测证据（主理人亲验）：`vbc.exe` 干净编译出 `VBChess.exe`（GUI）与 `ChessTests.exe`；**70/70 断言通过，退出码 0**；构建在本机 .NET Framework 4.x 下可复现。
- 关键缺陷 1 项：AI 后台线程竞态（陈旧着法落到新棋局，正确性问题，本地单机影响低）；测试覆盖缺口 5 项 P1（均为规则正确性分支但零断言）；构建/分发卫生 2 项 P2（提交预编译二进制、未签名）。
- 下一步：合并前关闭 P1 测试缺口 + 补线程 epoch 守卫；发布前移除 bin 下二进制并 Authenticode 签名。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go（Conditional Go） |
| 严重度分布 | 🔴 0 / 🟠 P1×7 / 🟡 P2×8 / 🟢 P3×1 |
| 关键行动项 | 7 条（见 §行动清单） |
| 建议负责人 | 产品官（代全栈修正）+ 主理人（合并/发布） |
| 上线阻塞项 | 无 |

### 阻塞项清单（Go/No-Go）
- **无**。所有 P0/P1 均为正确性测试缺口或低影响缺陷，可在合并后 / 发布前补完，不阻断当前构建与运行。

### 回滚预案
- **原子发布**：git tag 标记版本 + 保留上一个已签名 `VBChess.exe` 作为发布产物；出现严重缺陷时重发上一产物。
- **无 DB/迁移** → 回滚 = 重部署旧 exe（复制 / 安装包降级），发布目录保留最近 2 个版本。
- 若规则 bug 上线：hotfix + 重新签名 + 重发，写入 changelog。
- **上线后 1 周 canary**：统计“非法着法 / 崩溃”用户反馈；≥2 例确认规则错误即回滚上一版本。

---

## 1. 各成员核心结论

### 🔍 产品官（代码审查）
- 核心判断：核心规则引擎（两阶段走法生成、`IsAttacked` 单一例程、易位路径/被将检查、过路兵吃子移除揭开将军）实现正确；主要风险在 UI 层的 AI 后台线程竞态与若干 VB.NET 陷阱。
- 关键建议：① 加 `aiGeneration` epoch 计数器修复线程竞态；② `FindBestMove` 返回 `Move?`（Nullable）而非在值类型上 `Return Nothing`；③ 加 `Option Strict On`；④ `MateScore(9999)` 应高于最大叶子评估，避免“贪子弃杀”；⑤ 三次重复局面键仅在存在合法过路兵时编码 ep 格。

### 🛡️ 安全卫士（OWASP+STRIDE 审计）
- 核心判断：纯本地 WinForms 应用，无网络 / DB / 文件解析 / 外部反序列化输入，攻击面极小；VB.NET 全托管、无 P/Invoke / unsafe，内存安全。
- 关键建议：① 线程竞态归类 STRIDE Tampering/Integrity（P2，本地无数据损失，低实际风险）；② `build.bat` 用绝对系统路径调用 `vbc.exe`，PATH 劫持不可行（良好控制）；③ 不应把预编译 `bin/*.exe` 提交源码，发布 exe 应 Authenticode 签名。

### ✅ 质量门神（QA测试与发布）
- 核心判断：构建可复现、70 断言全绿，但多处正确性关键分支零断言；构建/分发仅限 Windows 且未签名。
- 关键建议：补 5 项 P1 测试（pinned-piece、check-evasion、过路兵揭开将军、子力不足 KBB/KNN/异色格象、深度3 性能）；`build.bat` 去掉 `pause` 接入 CI；`bin` 加入 `.gitignore`；签名后发布。

> 仅列实际上场成员：产品官、安全卫士、质量门神。

---

## 2. 综合审查发现（去重合并后按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源成员 |
|---|--------|------|------|---------|------|---------|
| 1 | 🟠 P1 | 正确性/并发 | ChessUI.vb:161-167,170-195,500-505 | AI 后台线程竞态：`WaitForAIThread` 仅 `Join(2000)` 不取消；慢搜索(>2s)时孤儿线程之后 `OnAIDone` 把“旧局面算出的着法”apply 到“新棋局”→ 棋盘被污染 | 加 `aiGeneration` epoch 计数器；`OnAIDone` 比对 gen 再落子；可选 `CancellationToken` | 产品官+安全卫士 |
| 2 | 🟠 P1 | 正确性/VB陷阱 | ChessAI.vb:238-240 + ChessUI.vb:172 | `FindBestMove` 声明 `As Move`（值类型）却 `Return Nothing`；`OnAIDone` 用 `best.Equals(Nothing)` 永远 False（值类型 `Equals(Nothing)` 恒假）。当前因 `gameOver` 先置位而不可达，但属死检查+隐性风险 | 声明 `As Move?` 使 Nothing 真实；改用 `best.HasValue` 判空 | 产品官 |
| 3 | 🟠 P1 | 测试缺口 | ChessCore.vb:437-447 | 被钉死棋子限制零断言（如象被车钉死不能离开线） | 增补 pinned-piece 测试 | 质量门神 |
| 4 | 🟠 P1 | 测试缺口 | ChessCore.vb:450-460 | 被将军时合法着法枚举 = 仅 吃/挡/逃，零断言 | 增补 check-evasion 测试 | 质量门神 |
| 5 | 🟠 P1 | 测试缺口 | ChessCore.vb:477-480 | 过路兵吃子揭开己方王（移除被吃兵后暴露给滑动子）零断言（逻辑正确但未验证） | 增补 EP 揭开将军测试 | 质量门神 |
| 6 | 🟠 P1 | 功能缺口 | ChessCore.vb:577-591 | 子力不足仅识别 KK/KN/KB；KBB/KNN/异色格象等真实和棋不判和，零断言 | 扩展 `IsInsufficientMaterial` + 测试 | 质量门神+产品官 |
| 7 | 🟠 P1 | 测试缺口 | ChessAI.vb / README | 深度3 性能（README 宣称~126ms）无断言，仅深度2<5s 被测 | 增补深度3 中局计时测试 | 质量门神 |
| 8 | 🟡 P2 | 工程 | ChessCore/ChessAI/ChessUI.vb 顶部 | 仅 `Option Explicit On`，缺 `Option Strict On` | 加 `Option Strict On` + `Option Infer On` | 产品官 |
| 9 | 🟡 P2 | 设计 | ChessCore.vb:41-81 | `Move` 为可变公共字段结构，无 `IEquatable` | 改为只读字段+构造函数，实现 `IEquatable(Of Move)` | 产品官 |
| 10 | 🟡 P2 | 正确性 | ChessAI.vb:26,184 | `MateScore=9999` < 最大叶子评估(~35000)，大子力差时引擎可能“贪子弃杀” | `MateScore` 设为 > 最大叶子评估（如 `Infinity-1000`） | 产品官 |
| 11 | 🟡 P2 | 正确性 | ChessCore.vb:131-145,566-574 | 三次重复局面键无条件编码 ep 格，当无合法过路兵时可能造成漏判（假阴性） | 仅当存在合法过路兵捕获时才编码 ep | 产品官 |
| 12 | 🟡 P2 | 构建/CI | build.bat:8-9,29,37 | `vbc` 路径硬编码 .NET Framework 4.x；无 .vbproj/.sln/CI；`pause`(line37) 阻塞 CI；预编译 `bin/*.exe` 提交源码 | 声明框架版本、去 pause、加 CI 跑 ChessTests；bin 加入 .gitignore | 安全卫士+质量门神 |
| 13 | 🟡 P2 | 分发安全 | build.bat / README:16-19 | 发布 exe 无 Authenticode 签名 → SmartScreen 摩擦，无法安全审验 | 时间戳签名 `VBChess.exe` | 安全卫士+质量门神 |
| 14 | 🟡 P2 | 测试缺口 | ChessTests.vb（无用例） | 易位权在“车在角格被吃”时撤销(`ToRow/ToCol==corner`)逻辑正确但零断言；退化局面(空盘 IsAttacked/单王/FindBestMove 终局)无测试；升变 SAN("=Q")未断言 | 增补对应测试 | 质量门神+产品官 |
| 15 | 🟡 P2 | 测试缺口 | ChessUI.vb:161-166 | AI 后台线程无并发测试，winexe 无 headless UI 冒烟测试 | 增补并发 / UI 冒烟（手动或自动化） | 质量门神 |
| 16 | 🟢 P3 | 死代码/潜在NRE | ChessUI.vb:55（LightSq 未用）、ChessAI.vb:265（EvaluatePosition 未用）、ChessAI.vb:118（GetPST idx0 返回 Nothing 若被调会 NRE） | 清理或加断言 | 产品官 |

---

## ✅ 行动清单（至少 3 条具体可执行项）

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 加 `aiGeneration` epoch 计数器，`OnAIDone` 比对后再落子（修复线程竞态） | 产品官/全栈 | P1 | 合并前 |
| 2 | `FindBestMove` 改 `As Move?`，`OnAIDone` 用 `HasValue` 判空 | 产品官 | P1 | 合并前 |
| 3 | 补 5 项 P1 规则测试（钉死 / 逃将 / EP揭开 / 子力不足扩展 / 深度3计时） | 质量门神 | P1 | QA 回归前 |
| 4 | `MateScore` 提到 > 最大叶子评估，避免贪子弃杀 | 产品官 | P2 | 本迭代 |
| 5 | 三次重复键仅在合法过路兵时编码 ep；加 `Option Strict On`；`Move` 改不可变 + `IEquatable` | 产品官 | P2 | 本迭代 |
| 6 | `build.bat` 去 `pause`、声明框架版本、接 CI 跑 ChessTests；`bin` 加入 `.gitignore` | 主理人 | P2 | 发布前 |
| 7 | 发布 exe Authenticode 时间戳签名；zip/安装包分发，勿提交二进制 | 主理人 | P2 | 发布 |

---

## ⚠️ 待完善 / 已知局限
- 线程竞态实际影响低（本地单机、无数据损失、需深度3慢搜索且用户在 2s 内 New/Undo 的特定时序），但属正确性 bug，建议仍修复。
- 子力不足未覆盖 KBB/KNN/异色格象等真实和棋（功能缺口，非崩溃）。
- 完整 SAN 歧义消解（同型棋子同列）尚未实现（ChessCore.vb:57 已声明为扩展项），`History` 在重叠时可能歧义。
- 无 PGN 导出、无迭代加深/置换表、无残局王 PST 切换（README 扩展方向已列）。

---

## 📚 成员产出索引
- gstack-product-reviewer（产品官）原始产出：代码审查发现清单（含行号与修复建议），线程竞态标 P0、值类型 Nothing 标 P1、其余 P2×5 / P3×1。
- gstack-security-officer（安全卫士）原始产出：安全风报名册（OWASP 10 项映射 + STRIDE），整体 GO(Conditional)。
- gstack-qa-lead（质量门神）原始产出：QA 判定 CONDITIONAL GO + 覆盖缺口清单 + 发布清单 + 回滚预案。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
