@echo off
rem ============================================================
rem TizuMark one-click build launcher (double-click me)
rem Keep this file ASCII-only: cmd parses .bat as OEM codepage,
rem so Chinese text here would garble. All messages live in
rem build-package.ps1 (saved with UTF-8 BOM).
rem ============================================================
setlocal
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-package.ps1"
if errorlevel 1 (
    echo.
    echo [FAIL] Build failed. Check the output above.
    pause
    exit /b 1
)
pause
