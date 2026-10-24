@echo off
setlocal
title AILEXSI Resonance Studio V6.0
rem Startdatei for Resonance Studio V6.0. Prefer INSTALL_BUILD_RUN_V6.0.cmd.
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "%ROOT%\package.json" (
  echo Fehler: package.json fehlt. Start-V5.cmd liegt in legacy und startet das Repo eine Ebene darueber.
  echo Nicht in ResonanceStudio V4 starten.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Fehler: Node.js wurde nicht gefunden. Befehl: node
  echo Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.
  echo Kein Download, kein Store, kein kostenpflichtiges Tool.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo Fehler: npm wurde nicht gefunden. Befehl: npm
  echo Bitte Node.js LTS, enthaelt npm, selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.
  pause
  exit /b 1
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
