@echo off
rem ===================================================================
rem  TizuMark one-click build
rem  Double-click this file to build NSIS installer + MSI + portable exe.
rem
rem  Optional args:
rem    -NoBump          build current version, do not bump
rem    -Version 1.2.6   set new version explicitly
rem    -Sign            sign the installer after build
rem ===================================================================
rem Switch console to UTF-8 so Node/npm Chinese output shows correctly
chcp 65001 >nul
title TizuMark Build
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-release.ps1" %*

if errorlevel 1 (
  echo.
  echo BUILD FAILED - see the messages above or build-output.log
  pause
)
exit /b %errorlevel%
