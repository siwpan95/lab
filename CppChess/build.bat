@echo off
rem ================================================================
rem  CppChess build script  pure ASCII content  GBK-safe  CRLF
rem  Builds: bin\cppchess.exe  CLI: test / selfplay / bench / play
rem  Compiler priority: g++ MinGW  then  MSVC vcvars64.bat
rem  MSVC auto-detect: F:\VS2022 first  then common C drive paths
rem  NOTE: this script avoids ALL parentheses in code and comments
rem  because cmd parses parens even inside rem lines and for blocks
rem  and a stray close paren breaks the whole parse with
rem  the message: the system cannot find the file and so on
rem  CI note: no pause  exits with proper errorlevel for automation
rem ================================================================
cd /d "%~dp0"

rem --- try g++ first  no env setup needed ---
set "GPP="
where g++ >nul 2>nul
if not errorlevel 1 set "GPP=g++"
if not defined GPP if exist "C:\tools\mingw64\bin\g++.exe" set "GPP=C:\tools\mingw64\bin\g++.exe"
if not defined GPP if exist "C:\ProgramData\chocolatey\bin\g++.exe" set "GPP=C:\ProgramData\chocolatey\bin\g++.exe"
if not defined GPP if exist "C:\msys64\mingw64\bin\g++.exe" set "GPP=C:\msys64\mingw64\bin\g++.exe"
if not defined GPP if exist "E:\mingw64\bin\g++.exe" set "GPP=E:\mingw64\bin\g++.exe"
if defined GPP goto :build_gpp

rem --- g++ not found: try MSVC via vcvars64.bat ---
echo [info] g++ not found, trying MSVC via vcvars64.bat
set "VCVARS="

rem explicit candidates  F drive first per user request
if not defined VCVARS if exist "F:\VS2022\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=F:\VS2022\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "F:\VS2022Community\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=F:\VS2022Community\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "F:\VisualStudio2022\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=F:\VisualStudio2022\VC\Auxiliary\Build\vcvars64.bat"

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
echo             This auto-detects F:\VS2022\VC\Auxiliary\Build\vcvars64.bat.
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
