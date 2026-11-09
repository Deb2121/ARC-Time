@echo off
REM -----------------------------------------------------------------------------
REM  ARCnordic Tid - start locally (no hosting). Double-click, or run from VS Code:
REM  Terminal > Run Task... > "Start ARCnordic Tid".
REM  Needs Docker Desktop running. Opens http://localhost:3000 when ready.
REM  Stop with Ctrl+C in this window (the database keeps running in Docker).
REM -----------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title ARCnordic Tid

REM Find Node.js and pnpm even if this window's PATH predates their installation.
where node >nul 2>&1 || set "PATH=%ProgramFiles%\nodejs;%PATH%"
where pnpm.cmd >nul 2>&1 || set "PATH=%APPDATA%\npm;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js er ikke installeret. Installer Node.js LTS fra https://nodejs.org og proev igen.
  echo.
  pause
  exit /b 1
)
where pnpm.cmd >nul 2>&1
if errorlevel 1 (
  echo Installerer pnpm...
  call npm.cmd install -g pnpm@10 || goto :fail
  set "PATH=%APPDATA%\npm;%PATH%"
)

REM Already running? Just open the browser.
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:4000/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo ARCnordic Tid koerer allerede - aabner browseren.
  start "" http://localhost:3000
  exit /b 0
)

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Docker Desktop koerer ikke. Start Docker Desktop, vent til den er klar, og proev igen.
  echo.
  pause
  exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Installerer pakker ^(foerste gang^)...
  call pnpm.cmd install || goto :fail
)

echo Starter databasen...
docker compose up -d db || goto :fail
set /a tries=0
:waitdb
docker compose exec -T db pg_isready -U arc_owner -d arc_tid >nul 2>&1
if errorlevel 1 (
  set /a tries+=1
  if %tries% gtr 30 goto :fail
  timeout /t 2 /nobreak >nul
  goto :waitdb
)

REM Daily safety backup before any migration (backups\, newest 14 kept - D-027).
call node scripts\db-backup.mjs --daily

echo Opdaterer databasen og demo-data...
call pnpm.cmd db:migrate || goto :fail
call pnpm.cmd db:seed || goto :fail

REM Open the browser as soon as the web app answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 90; $i++) { try { Invoke-WebRequest http://localhost:3000/login -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep 1 } }"

REM Default: test version (production build - no developer tools or technical error overlays, as users see it).
REM "Start-ARCnordic-Tid.cmd dev" starts developer mode with hot reload and Next.js dev tools (developers only).
echo.
echo  ARCnordic Tid starter paa http://localhost:3000   (log ind: lv@demo.arcnordic.test / demo1234)
echo  Stop med Ctrl+C.
echo.
if /i "%~1"=="dev" (
  echo  Udviklertilstand - kun til udviklere.
  call pnpm.cmd dev
) else (
  echo  Bygger testudgaven, det tager et minuts tid...
  call pnpm.cmd serve
)
exit /b 0

:fail
echo.
echo  Noget gik galt under opstart. Se beskeden ovenfor.
pause
exit /b 1
