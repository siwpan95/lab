@echo off
rem ================================================================
rem  CppChess build script  pure ASCII content  GBK-safe  CRLF
rem  Builds: bin\cppchess.exe  CLI: test / selfplay / bench / play
rem  Compiler priority: g++ MinGW  then  MSVC vcvars64.bat
rem  MSVC auto-detect: env LAB_VCVARS, then standard VS 2022 install paths
rem  NOTE: this script avoids ALL parentheses in code and comments
rem  because cmd parses parens even inside rem lines and for blocks
rem  and a stray close paren breaks the whole parse with
rem  the message: the system cannot find the file and so on
rem  CI note: no pause  exits with proper errorlevel for automation
rem ================================================================
cd /d "%~dp0"

rem --- try g++ first  no env setup needed ---
rem 2026-09-28 去本地化：删掉了 C:\tools / C:\msys64 / E:\mingw64 这些**机器专属**候选，
rem 改为 PATH 优先 + 环境变量覆盖。装在别处时设 LAB_GPP 指向 g++.exe 即可。
set "GPP="
if defined LAB_GPP if exist "%LAB_GPP%" set "GPP=%LAB_GPP%"
if not defined GPP where g++ >nul 2>nul
if not defined GPP if not errorlevel 1 set "GPP=g++"
if not defined GPP if exist "C:\ProgramData\chocolatey\bin\g++.exe" set "GPP=C:\ProgramData\chocolatey\bin\g++.exe"
if defined GPP goto :build_gpp

rem --- g++ not found: try MSVC via vcvars64.bat ---
echo [info] g++ not found, trying MSVC via vcvars64.bat
set "VCVARS="

rem 环境变量优先，其次是 Visual Studio 的**标准安装位置**（各机一致，非机器专属）
if defined LAB_VCVARS if exist "%LAB_VCVARS%" set "VCVARS=%LAB_VCVARS%"

rem standard C drive locations  fallback
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"

if not defined VCVARS goto :nocompiler

echo [info] Using MSVC environment: %VCVARS%
call "%VCVARS%" >nul 2>nul
if errorlevel 1 goto :vcfail

if not exist bin mkdir bin
echo [1/2] Compiling cppchess.exe  MSVC cl
cl /std:c++17 /O2 /EHsc /utf-8 /nologo /Fobin\ /Fe:bin\cppchess.exe main.cpp chess_core.cpp chess_ai.cpp tests.cpp
if errorlevel 1 goto :compilefail
echo       OK: bin\cppchess.exe
echo [2/2] Running rule tests
bin\cppchess.exe test
if errorlevel 1 goto :testfail
echo.
echo BUILD COMPLETE. Run bin\cppchess.exe to play.
exit /b 0

:nocompiler
echo [FAIL] No C++ compiler found.
echo   Option A: install MinGW-w64 g++ and add to PATH.
echo   Option B: install Visual Studio with Desktop development with C++.
echo             This auto-detects the standard VS 2022 vcvars64.bat.
echo   Or point directly: set LAB_GPP=...\g++.exe  /  set LAB_VCVARS=...\vcvars64.bat
exit /b 1

:vcfail
echo [FAIL] vcvars64.bat failed to initialize.
exit /b 1

:compilefail
echo [FAIL] compile errors.
exit /b 1

:testfail
echo [FAIL] some tests failed.
exit /b 1

:build_gpp
if not exist bin mkdir bin
echo [1/2] Compiling cppchess.exe  g++
%GPP% -std=c++17 -O2 -o bin\cppchess.exe main.cpp chess_core.cpp chess_ai.cpp tests.cpp
if errorlevel 1 goto :compilefail
echo       OK: bin\cppchess.exe
echo [2/2] Running rule tests
bin\cppchess.exe test
if errorlevel 1 goto :testfail
echo.
echo BUILD COMPLETE. Run bin\cppchess.exe to play.
exit /b 0
