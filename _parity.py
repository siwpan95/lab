# -*- coding: utf-8 -*-
"""跨语言测试套件结构一致性校验。

判据（2026-09-28 重写。旧版把**全部**断言名混在一起做字符串精确比对，
于是把「同一批 perft 检查的不同写法」也当成缺失，报出「各语言缺 72~74」的误导结论 ——
实际是**判据把两种不同性质的东西混在一起**）：

  · **97 项核心断言** —— 必须**逐字一致**（这就是 README 说的「97 项自测」，
    也是各语言真正要对齐的契约）。参考集 = 各语言并集，任一版本缺/多都要报。
  · **perft 黄金断言** —— 按 `perft_spec.txt` 判定：
      - 规范**要求**的 5 条（`Perft Start d3/d4`、`Perft Kiwipete d3`、`Perft Pos3 d4`、`Perft Pos5 d3`）
        每种语言都必须有；
      - 规范**允许**的可选加项（`Perft Kiwipete d4`、`Perft Pos5 d4`）只有快语言有，**不算缺**。
    断言名一律用规范形态 `Perft <Pos> d<n> = <value>`（由本文件同时校验）。

退出码：0 = 通过；1 = 有核心断言不一致 或 缺规范要求的 perft 断言。
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
LAB = os.path.dirname(os.path.abspath(__file__))
FILES = {
    "C++": "CppChess/tests.cpp",
    "Python": "PyChess/tests.py",
    "C#": "CSharpChess/Tests.cs",
    "TypeScript": "TsChess/tests.ts",
    "JavaScript": "JsChess/tests.js",
    "Java": "JavaChess/Tests.java",
    "Rust": "RustChess/src/tests.rs",
    "Go": "GoChess/tests.go",
}

# 匹配 Check("name" / check('name' / check!("name" 中的字面量断言名
PAT = re.compile(r'\bcheck\s*!?\s*\(\s*["\']([^"\']{2,160})["\']', re.IGNORECASE)
CALL = re.compile(r'\bcheck\s*!?\s*\(', re.IGNORECASE)

# 注释剥离（2026-09-28 补，**修正本文件自身的一个缺陷**）：
#   旧版直接在**整份文件文本**上跑正则，于是把**注释掉的**断言也算作"已声明"。
#   实证：RustChess/src/tests.rs 里两条 perft 被注释掉并标注「参考，>2M 节点，慢」——
#   旧版因此报 Rust「含可选 2 条」，而**实跑只有 111 条**（97 核心 + 14 perft）。
#
# 实现注意（第二版踩的坑，一并记下）：**不能拿整份文本做 `/*…*/` 与行注释的粗剥离** ——
#   字符串里出现的 `#`（断言名 `…（Qh8#）`）或 `/` 会被误当注释起点，把行截断，
#   于是名字正则跨行匹配到源码，报出「名字里含 Python 源码」这种荒谬结果。
#   ⇒ 必须**逐行**处理，并且**引号感知**：只有不在字符串内的注释标记才截断。


def _marker_outside_string(s, marker):
    """返回 marker 在 s 中**不在字符串内**的首次下标；没有则 -1。"""
    q = None
    i = 0
    while i < len(s):
        c = s[i]
        if q:
            if c == "\\":
                i += 2
                continue
            if c == q:
                q = None
        else:
            if c in "\"'":
                q = c
            elif s.startswith(marker, i):
                return i
        i += 1
    return -1


def live_lines(text, lang):
    """逐行返回「去掉注释后」的代码行；整行注释与块注释跳过。"""
    marker = "#" if lang == "Python" else "//"
    out, in_block = [], False
    for raw in text.splitlines():
        s = raw
        if in_block:
            j = s.find("*/")
            if j == -1:
                continue
            s = s[j + 2:]
            in_block = False
        while "/*" in s:
            i = s.index("/*")
            j = s.find("*/", i + 2)
            if j == -1:
                s, in_block = s[:i], True
                break
            s = s[:i] + s[j + 2:]
        k = _marker_outside_string(s, marker)
        if k != -1:
            s = s[:k]
        st = s.strip()
        if not st or st.startswith(("*", marker)):
            continue
        out.append(s)
    return out

# perft_spec.txt 第 83–88 行给定的**必需**断言（规范原文用的就是这套名字）
PERFT_REQUIRED = {
    "Perft Start d3 = 8902",
    "Perft Start d4 = 197281",
    "Perft Kiwipete d3 = 97862",
    "Perft Pos3 d4 = 43238",
    "Perft Pos5 d3 = 62379",
}
# 规范允许的**可选**加项（"性能强的语言可额外加"）
PERFT_OPTIONAL = {
    "Perft Kiwipete d4 = 4085603",
    "Perft Pos5 d4 = 2103487",
}
PERFT_NAME = re.compile(r"^Perft (Start|Kiwipete|Pos3|Pos5) d[1-9] = \d+$")
CANON_HINT = ('规范形态为 `Perft <Pos> d<n> = <value>`，'
              'Pos ∈ {Start, Kiwipete, Pos3, Pos5}（见 perft_spec.txt 第 83–88 行）')

data = {}
for lang, rel in FILES.items():
    p = os.path.join(LAB, rel)
    if not os.path.exists(p):
        data[lang] = None
        continue
    txt = open(p, encoding="utf-8", errors="ignore").read()
    live = "\n".join(live_lines(txt, lang))   # 只统计**会执行**的断言，注释掉的不算
    names = PAT.findall(live)
    data[lang] = {
        "all": names,
        "calls": len(CALL.findall(live)),
        "perft": [n for n in names if n.lower().startswith("perft")],
        "core": [n for n in names if not n.lower().startswith("perft")],
    }

ok = True
print("=" * 78)
print("跨语言断言一致性报告")
print("  核心断言：必须逐字一致   |   perft 断言：按 perft_spec.txt 判定（可选加项不算缺）")
print("=" * 78)

missing_core_sets = {k: v for k, v in data.items() if v}
if not missing_core_sets:
    print("没有任何语言文件可读 —— 检查 FILES 路径")
    sys.exit(1)

core_ref = set()
for v in data.values():
    if v:
        core_ref |= set(v["core"])
perft_ref = set()
for v in data.values():
    if v:
        perft_ref |= set(v["perft"])

print("\n【一】核心断言（非 perft）")
print("%-12s %8s %8s %8s %8s" % ("语言", "Check数", "核心名", "缺", "多"))
print("-" * 78)
for lang in FILES:
    v = data[lang]
    if not v:
        print("%-12s  FILE_MISSING" % lang)
        ok = False
        continue
    miss = core_ref - set(v["core"])
    extra = set(v["core"]) - core_ref
    flag = "" if not miss and not extra else "   ← 不一致"
    print("%-12s %8d %8d %8d %8d%s" % (lang, v["calls"], len(v["core"]), len(miss), len(extra), flag))
    if miss or extra:
        ok = False
        for m in sorted(miss)[:5]:
            print("        缺: %s" % m)
        for e in sorted(extra)[:5]:
            print("        多: %s" % e)
print("  核心断言参考集大小（各语言并集）= %d" % len(core_ref))

print("\n【二】perft 黄金断言（按 perft_spec.txt）")
print("%-12s %6s %10s %10s %s" % ("语言", "条数", "缺必需", "含可选", "命名合规"))
print("-" * 78)
for lang in FILES:
    v = data[lang]
    if not v:
        continue
    ps = set(v["perft"])
    miss_req = PERFT_REQUIRED - ps
    has_opt = PERFT_OPTIONAL & ps
    bad_name = [n for n in v["perft"] if not PERFT_NAME.match(n)]
    bad = "✔" if not bad_name else "✘ %d 条" % len(bad_name)
    flag = "" if not miss_req and not bad_name else "   ← 不合格"
    print("%-12s %6d %10d %10d %s%s"
          % (lang, len(v["perft"]), len(miss_req), len(has_opt), bad, flag))
    if miss_req:
        ok = False
        for m in sorted(miss_req):
            print("        缺必需: %s" % m)
    if bad_name:
        ok = False
        for n in bad_name[:5]:
            print("        命名不合规: %s" % n)
        print("        %s" % CANON_HINT)
print("  规范必需 %d 条 · 可选加项 %d 条 · 实际并集 %d 条"
      % (len(PERFT_REQUIRED), len(PERFT_OPTIONAL), len(perft_ref)))
opt_only = perft_ref - PERFT_REQUIRED - PERFT_OPTIONAL
if opt_only:
    print("  ⚠ 并集里还有规范之外的自定义 perft 断言 %d 条：%s" % (len(opt_only), sorted(opt_only)[:5]))

print()
print("=" * 78)
print("结论：%s" % ("✅ 通过 —— 核心断言逐字一致，perft 断言满足规范"
                  if ok else "❌ 不通过 —— 见上方逐条"))
sys.exit(0 if ok else 1)
