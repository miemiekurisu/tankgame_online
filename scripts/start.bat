@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ====================================================================
REM TankGame Online - One-Click Startup Script (Windows)
REM
REM Features: Auto-detect environment - Install deps - Start server + client
REM Usage: scripts\start.bat
REM ====================================================================

cd /d "%~dp0\.."

echo.
echo ==================================================
echo    TankGame Online - One-Click Launcher (Windows)
echo ==================================================
echo.

REM ====== 1. Environment Check ======
echo [INFO]  Checking environment...

REM -- Node.js --
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL]  Node.js not found. Please install Node.js ^>= 18.x from https://nodejs.org
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER_FULL=%%v
for /f "tokens=1 delims=." %%a in ('node -v') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%

if %NODE_MAJOR% lss 18 (
    echo [FAIL]  Node.js ^>= 18 required, current: %NODE_VER_FULL%
    pause
    exit /b 1
)
echo [OK]    Node.js %NODE_VER_FULL%

REM -- pnpm --
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN]  pnpm not found, installing via corepack...
    call corepack enable
    call corepack prepare pnpm@latest --activate
    where pnpm >nul 2>&1
    if %errorlevel% neq 0 (
        echo [FAIL]  Failed to install pnpm
        pause
        exit /b 1
    )
)
for /f "delims=" %%v in ('pnpm -v') do set PNPM_VER=%%v
echo [OK]    pnpm %PNPM_VER%

echo.

REM ====== 2. Install Dependencies ======
echo [INFO]  Installing dependencies...
call pnpm install
if %errorlevel% neq 0 (
    echo [FAIL]  Failed to install dependencies
    pause
    exit /b 1
)
echo [OK]    Dependencies installed

echo.

REM ====== 3. Start Services ======
REM Record PIDs of existing node.exe before starting
set "BEFORE_PIDS="
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq node.exe" /NH 2^>nul ^| findstr /R "[0-9]"') do (
    set "BEFORE_PIDS=!BEFORE_PIDS! %%p"
)

echo [INFO]  Starting server on port 3000...
start "TankGame-Server" /min cmd /c "cd /d "%cd%" && pnpm --filter @tankgame/server dev"

echo [INFO]  Starting client dev server on port 5173...
start "TankGame-Client" /min cmd /c "cd /d "%cd%" && pnpm --filter @tankgame/client dev"

REM ====== 4. Wait for Services ======
timeout /t 3 /nobreak >nul

REM Capture PIDs of newly spawned node.exe processes
set "NEW_PIDS="
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq node.exe" /NH 2^>nul ^| findstr /R "[0-9]"') do (
    echo !BEFORE_PIDS! | findstr /C:" %%p " >nul 2>&1
    if errorlevel 1 (
        set "NEW_PIDS=!NEW_PIDS! %%p"
    )
)

echo.
echo ==================================================
echo    TankGame Online is READY!
echo.
echo    Game:  http://localhost:5173
echo    API:   ws://localhost:3000
echo.
echo    Press any key to stop all services.
echo ==================================================
echo.

pause >nul

REM ====== 5. Graceful Shutdown ======
echo.
echo [INFO]  Shutting down...

REM Kill window-title matched cmd shells
taskkill /FI "WINDOWTITLE eq TankGame-Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq TankGame-Client*" /F >nul 2>&1

REM Kill all node.exe processes spawned by us
for %%p in (!NEW_PIDS!) do (
    taskkill /PID %%p /T /F >nul 2>&1
)

REM Fallback: kill any node.exe listening on our ports
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)

echo [OK]    All services stopped.
pause
