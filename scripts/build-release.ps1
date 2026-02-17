# ──────────────────────────────────────────────────────────────
# TankGame Online — 构建 Release 发布包 (Windows PowerShell)
#
# 将项目构建所需的最小文件集复制到 release/ 目录，
# 生成可直接拷贝到 Linux 服务器的部署包。
#
# 用法:
#   powershell -File scripts\build-release.ps1              # 默认输出到 .\release
#   powershell -File scripts\build-release.ps1 C:\tmp\pkg   # 指定输出目录
# ──────────────────────────────────────────────────────────────
param(
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path

if (-not $OutputDir) {
    $ReleaseDir = Join-Path $ProjectRoot 'release'
} else {
    $ReleaseDir = $OutputDir
}

Write-Host "======================================"
Write-Host "  TankGame Online — 构建发布包"
Write-Host "======================================"
Write-Host ""
Write-Host "  项目目录: $ProjectRoot"
Write-Host "  输出目录: $ReleaseDir"
Write-Host ""

# ── 清理旧的 release 目录 ──
if (Test-Path $ReleaseDir) {
    Write-Host "⚠  清理旧的 release 目录..."
    Remove-Item -Recurse -Force $ReleaseDir
}

New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

# ── 复制 Docker 构建必需文件 ──
Write-Host "📦 复制项目文件..."

# 根目录配置
Copy-Item (Join-Path $ProjectRoot 'Dockerfile')         $ReleaseDir
Copy-Item (Join-Path $ProjectRoot 'docker-compose.yml') $ReleaseDir
Copy-Item (Join-Path $ProjectRoot '.dockerignore')      $ReleaseDir
Copy-Item (Join-Path $ProjectRoot 'package.json')       $ReleaseDir
Copy-Item (Join-Path $ProjectRoot 'pnpm-lock.yaml')     $ReleaseDir
Copy-Item (Join-Path $ProjectRoot 'pnpm-workspace.yaml') $ReleaseDir
Copy-Item (Join-Path $ProjectRoot 'tsconfig.base.json') $ReleaseDir

# shared 包
$sharedDir = Join-Path $ReleaseDir 'packages\shared'
New-Item -ItemType Directory -Path $sharedDir -Force | Out-Null
Copy-Item (Join-Path $ProjectRoot 'packages\shared\package.json')  $sharedDir
Copy-Item (Join-Path $ProjectRoot 'packages\shared\tsconfig.json') $sharedDir
Copy-Item (Join-Path $ProjectRoot 'packages\shared\src') (Join-Path $sharedDir 'src') -Recurse

# server 包
$serverDir = Join-Path $ReleaseDir 'packages\server'
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
Copy-Item (Join-Path $ProjectRoot 'packages\server\package.json')  $serverDir
Copy-Item (Join-Path $ProjectRoot 'packages\server\tsconfig.json') $serverDir
Copy-Item (Join-Path $ProjectRoot 'packages\server\src') (Join-Path $serverDir 'src') -Recurse

# client 包
$clientDir = Join-Path $ReleaseDir 'packages\client'
New-Item -ItemType Directory -Path $clientDir -Force | Out-Null
Copy-Item (Join-Path $ProjectRoot 'packages\client\package.json')    $clientDir
Copy-Item (Join-Path $ProjectRoot 'packages\client\tsconfig.json')   $clientDir
Copy-Item (Join-Path $ProjectRoot 'packages\client\vite.config.ts')  $clientDir
Copy-Item (Join-Path $ProjectRoot 'packages\client\index.html')      $clientDir
Copy-Item (Join-Path $ProjectRoot 'packages\client\src') (Join-Path $clientDir 'src') -Recurse

# 部署脚本
$installSrc = Join-Path $ProjectRoot 'scripts\install.sh'
if (Test-Path $installSrc) {
    Copy-Item $installSrc (Join-Path $ReleaseDir 'install.sh')
}

Write-Host "✅ 文件复制完成"

# ── 生成版本信息 ──
try {
    $Version = (node -e "console.log(require('$($ProjectRoot -replace '\\','/')/package.json').version)" 2>$null)
} catch {
    $Version = "0.1.0"
}
if (-not $Version) { $Version = "0.1.0" }

$BuildTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'

try {
    $GitHash = (git -C $ProjectRoot rev-parse --short HEAD 2>$null)
} catch {
    $GitHash = "unknown"
}
if (-not $GitHash) { $GitHash = "unknown" }

$versionContent = @"
TankGame Online
Version:    $Version
Build Time: $BuildTime
Git Commit: $GitHash
"@
Set-Content -Path (Join-Path $ReleaseDir 'VERSION') -Value $versionContent -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "✅ 发布包构建完成!"
Write-Host ""
Write-Host "  输出目录: $ReleaseDir"
Write-Host "  版本:     $Version ($GitHash)"
Write-Host ""
Write-Host "  部署步骤:"
Write-Host "  1. 将 release/ 目录整体拷贝到 Linux 服务器"
Write-Host "     scp -r $ReleaseDir user@server:/opt/tankgame"
Write-Host ""
Write-Host "  2. 在服务器上执行安装脚本"
Write-Host "     cd /opt/tankgame && bash install.sh"
Write-Host "======================================"
