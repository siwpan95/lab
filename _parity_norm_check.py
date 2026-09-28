# -*- coding: utf-8 -*-
"""验证假设：八种语言的断言**集合**其实一致，只是**命名格式**不同。

做法：把断言名做「语义归一」后再比 ——
  · 去掉 `= 20` / `== 20` / `: 20` 这类**期望值尾巴**
  · 统一大小写、压缩空白、去掉尾部标点
  · 把 perft 类名字规整成 `<pos> d<n>`（如 `Perft Start d1 = 20` → `perft start d1`）
若归一后各语言集合一致 ⇒ 原报告是**判据太严**（字符串精确比对）造成的假差异。
"""
import os
import re
import sys
from collections import Counter

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
PAT = re.compile(r'\bcheck\s*!?\s*\(\s*["\']([^"\']{2,160})["\']', re.IGNORECASE)


def norm(s):
    t = s.strip()
    # 去掉期望值尾巴：`= 20` / `== 20` / `: 20` / `-> 20`
    t = re.sub(r"\s*(?:==|=|:|->)\s*-?\d+\s*$", "", t)
    t = t.lower()
    t = re.sub(r"\s+", " ", t)
    t = t.strip(" .。:：,，;；")
    return t


def names(rel):
    p = os.path.join(LAB, rel)
    if not os.path.exists(p):
        return None
    txt = open(p, encoding="utf-8", errors="ignore").read()
    return [PAT.findall(txt)][0]


raw, nm = {}, {}
for k, rel in FILES.items():
    ns = names(rel)
    raw[k] = set(ns) if ns is not None else None
    nm[k] = set(norm(x) for x in ns) if ns is not None else None

print("=" * 76)
print("%-12s %8s %8s   %8s %8s" % ("语言", "原名数", "归一后", "缺(原名)", "缺(归一)"))
print("-" * 76)
ru = set().union(*[v for v in raw.values() if v])
nu = set().union(*[v for v in nm.values() if v])
for k in FILES:
    if raw[k] is None:
        print("%-12s %8s" % (k, "FILE_MISSING"))
        continue
    print("%-12s %8d %8d   %8d %8d"
          % (k, len(raw[k]), len(nm[k]), len(ru - raw[k]), len(nu - nm[k])))
print("-" * 76)
print("原始并集 = %d 个名字；归一后并集 = %d 个" % (len(ru), len(nu)))
print()
print("=== 归一后仍缺的（各语言前 6 个）===")
for k in FILES:
    if nm[k] is None:
        continue
    miss = sorted(nu - nm[k])
    print("[%s] 缺 %d：%s" % (k, len(miss), " | ".join(miss[:6]) if miss else "无 ✅"))
