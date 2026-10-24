@echo off
setlocal
title AILEXSI Resonance Studio V6.0 - Install / Build / Run
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "%ROOT%\package.json" (
  echo Fehler: package.json fehlt. INSTALL_BUILD_RUN_V5.5.cmd liegt in legacy und startet das Repo eine Ebene darueber.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Fehler: Node.js wurde nicht gefunden. Befehl: node
  echo Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.
  pause
  exit /b 1
)

rem Resolve npm.cmd for the PowerShell helper. Never a PowerShell npm alias
rem (that can split to n + pm -> Unknown command: "pm").
set "NPM_CMD="
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
  set "NPM_CMD=%%I"
  goto :have_npm
)
:have_npm
if not defined NPM_CMD (
  echo Fehler: npm.cmd wurde nicht gefunden. Befehl: npm.cmd
  echo Bitte Node.js LTS, enthaelt npm, selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.
  pause
  exit /b 1
)

where rustc >nul 2>&1
if errorlevel 1 (
  echo Hinweis: rustc fehlt. Tauri-EXE-Build wird fehlschlagen. Vite-Dev ist trotzdem moeglich.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\build-v5.5-windows.ps1"
if errorlevel 1 (
  echo Build fehlgeschlagen. Starte Dev-Fallback...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\run-v5.5.ps1"
  set "ERR=%ERRORLEVEL%"
  if not "%ERR%"=="0" if not "%ERR%"=="10" pause
  endlocal
  exit /b %ERR%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\run-v5.5.ps1"
set "ERR=%ERRORLEVEL%"
if "%ERR%"=="10" (
  echo Bereit: http://127.0.0.1:1421
  pause
  endlocal
  exit /b 0
)
if not "%ERR%"=="0" (
  echo.
  pause
)
endlocal
exit /b %ERR%
