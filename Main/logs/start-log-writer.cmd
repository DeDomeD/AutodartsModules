@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte Node.js installieren.
  pause
  exit /b 1
)
echo Starte Autodarts Modules Log Writer...
node log-writer.js
pause
