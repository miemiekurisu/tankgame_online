@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
:: ──────────────────────────────────────────────────────────────
:: TankGame Online — 构建 Release 发布包 (Windows CMD)
::
:: 用法:
::   scripts\build-release.bat              默认输出到 .\release
::   scripts\build-release.bat C:\tmp\pkg   指定输出目录
:: ──────────────────────────────────────────────────────────────

:: 定位项目根目录
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
set "PROJECT_ROOT=%CD%"
popd

if "%~1"=="" (
    set "RELEASE_DIR=%PROJECT_ROOT%\release"
) else (
    set "RELEASE_DIR=%~1"
)

echo ======================================
echo   TankGame Online — 构建发布包
echo ======================================
echo.
echo   项目目录: %PROJECT_ROOT%
echo   输出目录: %RELEASE_DIR%
echo.

:: ── 清理旧的 release 目录 ──
if exist "%RELEASE_DIR%" (
    echo [!] 清理旧的 release 目录...
    rd /s /q "%RELEASE_DIR%"
)
mkdir "%RELEASE_DIR%"

:: ── 复制 Docker 构建必需文件 ──
echo [*] 复制项目文件...

:: 根目录配置
copy /y "%PROJECT_ROOT%\Dockerfile"          "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\docker-compose.yml"  "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\.dockerignore"       "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\package.json"        "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\pnpm-lock.yaml"      "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\pnpm-workspace.yaml" "%RELEASE_DIR%\" >nul
copy /y "%PROJECT_ROOT%\tsconfig.base.json"  "%RELEASE_DIR%\" >nul

:: shared 包
mkdir "%RELEASE_DIR%\packages\shared" >nul 2>&1
copy /y "%PROJECT_ROOT%\packages\shared\package.json"  "%RELEASE_DIR%\packages\shared\" >nul
copy /y "%PROJECT_ROOT%\packages\shared\tsconfig.json" "%RELEASE_DIR%\packages\shared\" >nul
xcopy /s /e /i /q /y "%PROJECT_ROOT%\packages\shared\src" "%RELEASE_DIR%\packages\shared\src" >nul

:: server 包
mkdir "%RELEASE_DIR%\packages\server" >nul 2>&1
copy /y "%PROJECT_ROOT%\packages\server\package.json"  "%RELEASE_DIR%\packages\server\" >nul
copy /y "%PROJECT_ROOT%\packages\server\tsconfig.json" "%RELEASE_DIR%\packages\server\" >nul
xcopy /s /e /i /q /y "%PROJECT_ROOT%\packages\server\src" "%RELEASE_DIR%\packages\server\src" >nul

:: client 包
mkdir "%RELEASE_DIR%\packages\client" >nul 2>&1
copy /y "%PROJECT_ROOT%\packages\client\package.json"   "%RELEASE_DIR%\packages\client\" >nul
copy /y "%PROJECT_ROOT%\packages\client\tsconfig.json"  "%RELEASE_DIR%\packages\client\" >nul
copy /y "%PROJECT_ROOT%\packages\client\vite.config.ts" "%RELEASE_DIR%\packages\client\" >nul
copy /y "%PROJECT_ROOT%\packages\client\index.html"     "%RELEASE_DIR%\packages\client\" >nul
xcopy /s /e /i /q /y "%PROJECT_ROOT%\packages\client\src" "%RELEASE_DIR%\packages\client\src" >nul

:: 部署脚本
if exist "%PROJECT_ROOT%\scripts\install.sh" (
    copy /y "%PROJECT_ROOT%\scripts\install.sh" "%RELEASE_DIR%\install.sh" >nul
)

echo [OK] 文件复制完成

:: ── 生成版本信息 ──
set "VERSION=0.1.0"
for /f "delims=" %%v in ('node -e "console.log(require('%PROJECT_ROOT:\=/%/package.json').version)" 2^>nul') do set "VERSION=%%v"

set "GIT_HASH=unknown"
for /f "delims=" %%h in ('git -C "%PROJECT_ROOT%" rev-parse --short HEAD 2^>nul') do set "GIT_HASH=%%h"

:: UTC 时间
for /f "delims=" %%t in ('node -e "console.log(new Date().toISOString().replace('T',' ').slice(0,19)+' UTC')" 2^>nul') do set "BUILD_TIME=%%t"
if "!BUILD_TIME!"=="" set "BUILD_TIME=%date% %time%"

(
    echo TankGame Online
    echo Version:    !VERSION!
    echo Build Time: !BUILD_TIME!
    echo Git Commit: !GIT_HASH!
) > "%RELEASE_DIR%\VERSION"

echo.
echo ======================================
echo [OK] 发布包构建完成!
echo.
echo   输出目录: %RELEASE_DIR%
echo   版本:     !VERSION! (!GIT_HASH!)
echo.
echo   部署步骤:
echo   1. 将 release\ 目录整体拷贝到 Linux 服务器
echo      scp -r %RELEASE_DIR% user@server:/opt/tankgame
echo.
echo   2. 在服务器上执行安装脚本
echo      cd /opt/tankgame ^&^& bash install.sh
echo ======================================

endlocal
