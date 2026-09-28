@echo off
rem ================================================================
rem  VBChess build script  (pure ASCII content, GBK-safe)
rem  Builds: bin\VBChess.exe  (GUI)  +  bin\ChessTests.exe (console)
rem  Target Framework: .NET Framework 4.x (vbc.exe ships with Windows)
rem  CI note: no 'pause' — exits with proper errorlevel for automation
rem ================================================================
cd /d "%~dp0"
set VBC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\vbc.exe
if not exist "%VBC%" set VBC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\vbc.exe
if not exist bin mkdir bin

echo [1/3] Building GUI exe (VBChess.exe) ...
"%VBC%" -nologo -codepage:65001 -optimize -target:winexe -r:System.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -out:bin\VBChess.exe ChessCore.vb ChessAI.vb ChessUI.vb
if errorlevel 1 (
    echo [FAIL] GUI build errors
    exit /b 1
)
echo       OK: bin\VBChess.exe

echo [2/3] Building test exe (ChessTests.exe) ...
"%VBC%" -nologo -codepage:65001 -optimize -r:System.dll -out:bin\ChessTests.exe ChessCore.vb ChessAI.vb ChessTests.vb
if errorlevel 1 (
    echo [FAIL] test build errors
    exit /b 1
)
echo       OK: bin\ChessTests.exe

echo [3/3] Running rule tests ...
bin\ChessTests.exe
if errorlevel 1 (
    echo [FAIL] some tests failed
    exit /b 1
)

echo.
echo BUILD COMPLETE. Run bin\VBChess.exe to play.
