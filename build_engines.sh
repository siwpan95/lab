#!/usr/bin/env bash
# =============================================================================
# build_engines.sh — 重建 tournament/ 所需的「编译型」引擎产物
# -----------------------------------------------------------------------------
# 背景：本仓库的二进制产物（*.exe / *.dll / out/*.class）被 .gitignore 忽略，
#       不会入库。克隆到新机后，运行本脚本即可重建它们，使 10 引擎全部可跑。
#
# 本脚本只构建 tournament/engines.mjs 实际消费的产物：
#   C++   chess-cordis/drivers/cpp/cppchess_driver.exe   (MinGW g++ 或 MSVC)
#   C#    chess-cordis/drivers/csharp/bin/Release/net8.0/ChessEngineDriver.dll
#   F#    chess-cordis/drivers/fsharp/bin/Release/net8.0/FSharpChessDriver.dll
#   Java  chess-cordis/drivers/java/out/*.class
#
# 纯解释型引擎（go/rust/vb/ts/js/py）无需本脚本：
#   go/rust 用各自工具链（go/rustc）即时构建；vb/ts/js/py 由驱动直接解释运行。
#
# 用法：
#   ./build_engines.sh            # 构建全部（C++ 缺编译器时仅告警跳过）
#   ./build_engines.sh --verify   # 构建后额外跑 tournament/probe.mjs
#
# 环境变量（均可覆盖；默认值指向本机隔离安装路径）：
#   LAB_ROOT   仓库根（默认=本脚本所在目录）
#   CXX        C++ 编译器（默认 g++.exe；缺省时跳过 C++ 并告警）
#   DOTNET     dotnet 可执行文件（默认 D:/dotnet8/dotnet.exe，否则取 PATH 中 dotnet）
#   JAVAC      javac 可执行文件（默认 D:/jdk21/.../bin/javac.exe，否则取 PATH 中 javac）
# =============================================================================
set -u

LAB_ROOT="$(cd "$(dirname "$0")" && pwd)"
VERIFY=0
for a in "$@"; do [ "$a" = "--verify" ] && VERIFY=1; done

# --- 解析工具链（带本机默认回退） -------------------------------------------
CXX="${CXX:-E:/mingw64/bin/g++.exe}"
if command -v "$CXX" >/dev/null 2>&1; then
  CXX="$(command -v "$CXX")"
  HAVE_CXX=1
else
  HAVE_CXX=0
fi

if [ -z "${DOTNET:-}" ]; then
  if [ -x "D:/dotnet8/dotnet.exe" ]; then DOTNET="D:/dotnet8/dotnet.exe"
  else DOTNET="$(command -v dotnet || true)"; fi
fi

if [ -z "${JAVAC:-}" ]; then
  if [ -x "D:/jdk21/jdk-21.0.12.1+1/bin/javac.exe" ]; then JAVAC="D:/jdk21/jdk-21.0.12.1+1/bin/javac.exe"
  else JAVAC="$(command -v javac || true)"; fi
fi

echo "LAB_ROOT = $LAB_ROOT"
echo "CXX      = ${HAVE_CXX:-0}${HAVE_CXX:- }${CXX:-<none>}"
echo "DOTNET   = ${DOTNET:-<none>}"
echo "JAVAC    = ${JAVAC:-<none>}"
echo "----------------------------------------------------------------------"

rc=0

# --- C++ : JSON-stdio driver（编译自 CppChess 核心 + harness driver） ---------
if [ "$HAVE_CXX" = "1" ]; then
  echo "[cpp] building cppchess_driver.exe ..."
  "$CXX" -O2 -std=c++17 -I "$LAB_ROOT/CppChess" \
    "$LAB_ROOT/chess-cordis/drivers/cpp/driver.cpp" \
    "$LAB_ROOT/CppChess/chess_core.cpp" \
    "$LAB_ROOT/CppChess/chess_ai.cpp" \
    -o "$LAB_ROOT/chess-cordis/drivers/cpp/cppchess_driver.exe" \
    && echo "[cpp] OK -> chess-cordis/drivers/cpp/cppchess_driver.exe" \
    || { echo "[cpp] BUILD FAILED"; rc=1; }
else
  echo "[cpp] SKIP: 未找到 C++ 编译器。安装 MinGW-w64 g++ 并加入 PATH，"
  echo "       或设置 CXX=/path/to/g++.exe 后重跑。命令："
  echo "       g++.exe -O2 -std=c++17 -I $LAB_ROOT/CppChess \\"
  echo "         $LAB_ROOT/chess-cordis/drivers/cpp/driver.cpp \\"
  echo "         $LAB_ROOT/CppChess/chess_core.cpp $LAB_ROOT/CppChess/chess_ai.cpp \\"
  echo "         -o $LAB_ROOT/chess-cordis/drivers/cpp/cppchess_driver.exe"
fi

# --- C# : dotnet build -c Release --------------------------------------------
if [ -n "$DOTNET" ]; then
  echo "[cs] dotnet build -c Release (csharp) ..."
  "$DOTNET" build -c Release "$LAB_ROOT/chess-cordis/drivers/csharp/ChessEngineDriver.csproj" -v quiet \
    && echo "[cs] OK -> chess-cordis/drivers/csharp/bin/Release/net8.0/ChessEngineDriver.dll" \
    || { echo "[cs] BUILD FAILED"; rc=1; }
else
  echo "[cs] SKIP: 未找到 dotnet。安装 .NET 8 SDK 并设置 DOTNET=/path/dotnet.exe。"
fi

# --- F# : dotnet build -c Release --------------------------------------------
if [ -n "$DOTNET" ]; then
  echo "[fs] dotnet build -c Release (fsharp) ..."
  "$DOTNET" build -c Release "$LAB_ROOT/chess-cordis/drivers/fsharp/FSharpChessDriver.fsproj" -v quiet \
    && echo "[fs] OK -> chess-cordis/drivers/fsharp/bin/Release/net8.0/FSharpChessDriver.dll" \
    || { echo "[fs] BUILD FAILED"; rc=1; }
else
  echo "[fs] SKIP: 未找到 dotnet（同 C#）。"
fi

# --- Java : javac 编译核心 + driver 到 out/ ---------------------------------
if [ -n "$JAVAC" ]; then
  echo "[java] javac JavaChess core + Driver.java -> out/ ..."
  rm -rf "$LAB_ROOT/chess-cordis/drivers/java/out"
  mkdir -p "$LAB_ROOT/chess-cordis/drivers/java/out"
  "$JAVAC" -d "$LAB_ROOT/chess-cordis/drivers/java/out" \
    "$LAB_ROOT/JavaChess/ChessCore.java" \
    "$LAB_ROOT/JavaChess/ChessAI.java" \
    "$LAB_ROOT/chess-cordis/drivers/java/Driver.java" \
    && echo "[java] OK -> chess-cordis/drivers/java/out/*.class" \
    || { echo "[java] BUILD FAILED"; rc=1; }
else
  echo "[java] SKIP: 未找到 javac。安装 JDK 21 并设置 JAVAC=/path/javac.exe。"
fi

echo "----------------------------------------------------------------------"
if [ "$rc" = "0" ]; then echo "BUILD DONE (all attempted targets succeeded)";
else echo "BUILD DONE WITH ERRORS (rc=$rc)"; fi

# --- 可选：构建后探测 -------------------------------------------------------
if [ "$VERIFY" = "1" ]; then
  NODE="$(command -v node || true)"
  if [ -n "$NODE" ] && [ -f "$LAB_ROOT/tournament/probe.mjs" ]; then
    echo "[verify] running tournament/probe.mjs ..."
    ( cd "$LAB_ROOT/tournament" && "$NODE" probe.mjs )
  else
    echo "[verify] SKIP: node 或 tournament/probe.mjs 不可用。"
  fi
fi

exit $rc
