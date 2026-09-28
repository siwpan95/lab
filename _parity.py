# -*- coding: utf-8 -*-
# 跨语言测试套件结构一致性校验：提取各版本 tests 文件中的断言名（字面量字符串），
# 与 Python 版（参考集）比对，确认所有移植版本编码的是同一套 97 项断言 spec。
import re, os

# 仓根由本文件位置推导（原先写死 E:\lab；去本地化，克隆到哪都对）
LAB = os.path.dirname(os.path.abspath(__file__))
FILES = {
    "C++(参考)":   "CppChess/tests.cpp",
    "Python":      "PyChess/tests.py",
    "C#":          "CSharpChess/Tests.cs",
    "TypeScript":  "TsChess/tests.ts",
    "JavaScript":  "JsChess/tests.js",
    "Java":        "JavaChess/Tests.java",
    "Rust":        "RustChess/src/tests.rs",
    "Go":          "GoChess/tests.go",
}

# 匹配 Check("name" / check('name' / check!("name" 中的字面量断言名（大小写不敏感，可选 !）
PAT = re.compile(r'\bcheck\s*!?\s*\(\s*["\']([^"\']{2,160})["\']', re.IGNORECASE)
# 统计所有 Check 调用总数（含动态名）
CALL = re.compile(r'\bcheck\s*!?\s*\(', re.IGNORECASE)

data = {}
for lang, rel in FILES.items():
    p = os.path.join(LAB, rel)
    if not os.path.exists(p):
        data[lang] = (None, None, "FILE_MISSING")
        continue
    with open(p, encoding="utf-8", errors="ignore") as f:
        txt = f.read()
    names = PAT.findall(txt)
    total = len(CALL.findall(txt))
    data[lang] = (set(names), total, None)

# 参考集 = 所有语言提取到的断言名之并集（任一版本独有的错名都会被标出）
ref = set()
for names, total, err in data.values():
    if names:
        ref |= names

print("=" * 70)
print("跨语言断言集合一致性报告（参考集 = 各版本断言名并集）")
print("=" * 70)
print(f"{'语言':<12}{'断言总数':<10}{'字面量名数':<12}{'缺(相对并集)':<14}{'多(相对并集)'}")
for lang, rel in FILES.items():
    names, total, err = data[lang]
    if err:
        print(f"{lang:<12}{'-':<10}{'-':<12}{'-':<14}  {err}")
        continue
    missing = ref - names
    extra = names - ref
    print(f"{lang:<12}{total:<10}{len(names):<12}{len(missing):<14}{len(extra)}")

print("\n--- 各语言相对并集 缺失/多出的断言名 ---")
for lang, rel in FILES.items():
    names, total, err = data[lang]
    if err:
        continue
    missing = sorted(ref - names)
    extra = sorted(names - ref)
    if missing or extra:
        print(f"\n[{lang}] 缺 {len(missing)} / 多 {len(extra)}")
        for m in missing:
            print(f"   缺: {m}")
        for e in extra:
            print(f"   多: {e}")
    else:
        print(f"\n[{lang}] 与并集完全一致 (97 项)")
print("\n(若所有语言 缺=0 且 多=0，说明断言集合完全一致)")
