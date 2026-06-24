@echo off
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" (
  echo Node.js non e installato.
  echo Scaricalo da https://nodejs.org e riprova.
  pause
  exit /b 1
)
start "" http://localhost:3000
"%NODE%" server.js
pause
