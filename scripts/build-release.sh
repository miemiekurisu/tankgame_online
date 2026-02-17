#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# TankGame Online — 构建 Release 发布包
#
# 将项目构建所需的最小文件集复制到 release/ 目录，
# 生成可直接拷贝到 Linux 服务器的部署包。
#
# 用法:
#   bash scripts/build-release.sh            # 默认输出到 ./release
#   bash scripts/build-release.sh /tmp/pkg   # 指定输出目录
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="${1:-$PROJECT_ROOT/release}"

echo "======================================"
echo "  TankGame Online — 构建发布包"
echo "======================================"
echo ""
echo "  项目目录: $PROJECT_ROOT"
echo "  输出目录: $RELEASE_DIR"
echo ""

# ── 清理旧的 release 目录 ──
if [ -d "$RELEASE_DIR" ]; then
  echo "⚠  清理旧的 release 目录..."
  rm -rf "$RELEASE_DIR"
fi

mkdir -p "$RELEASE_DIR"

# ── 复制 Docker 构建必需文件 ──
echo "📦 复制项目文件..."

# 根目录配置
cp "$PROJECT_ROOT/Dockerfile"         "$RELEASE_DIR/"
cp "$PROJECT_ROOT/docker-compose.yml" "$RELEASE_DIR/"
cp "$PROJECT_ROOT/.dockerignore"      "$RELEASE_DIR/"
cp "$PROJECT_ROOT/package.json"       "$RELEASE_DIR/"
cp "$PROJECT_ROOT/pnpm-lock.yaml"     "$RELEASE_DIR/"
cp "$PROJECT_ROOT/pnpm-workspace.yaml" "$RELEASE_DIR/"
cp "$PROJECT_ROOT/tsconfig.base.json" "$RELEASE_DIR/"

# shared 包
mkdir -p "$RELEASE_DIR/packages/shared"
cp "$PROJECT_ROOT/packages/shared/package.json"  "$RELEASE_DIR/packages/shared/"
cp "$PROJECT_ROOT/packages/shared/tsconfig.json" "$RELEASE_DIR/packages/shared/"
cp -r "$PROJECT_ROOT/packages/shared/src"        "$RELEASE_DIR/packages/shared/"

# server 包
mkdir -p "$RELEASE_DIR/packages/server"
cp "$PROJECT_ROOT/packages/server/package.json"  "$RELEASE_DIR/packages/server/"
cp "$PROJECT_ROOT/packages/server/tsconfig.json" "$RELEASE_DIR/packages/server/"
cp -r "$PROJECT_ROOT/packages/server/src"        "$RELEASE_DIR/packages/server/"

# client 包
mkdir -p "$RELEASE_DIR/packages/client"
cp "$PROJECT_ROOT/packages/client/package.json"    "$RELEASE_DIR/packages/client/"
cp "$PROJECT_ROOT/packages/client/tsconfig.json"   "$RELEASE_DIR/packages/client/"
cp "$PROJECT_ROOT/packages/client/vite.config.ts"  "$RELEASE_DIR/packages/client/"
cp "$PROJECT_ROOT/packages/client/index.html"      "$RELEASE_DIR/packages/client/"
cp -r "$PROJECT_ROOT/packages/client/src"          "$RELEASE_DIR/packages/client/"

# 部署脚本
cp "$PROJECT_ROOT/scripts/install.sh" "$RELEASE_DIR/install.sh"
chmod +x "$RELEASE_DIR/install.sh"

echo "✅ 文件复制完成"

# ── 生成版本信息 ──
VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)" 2>/dev/null || echo "0.1.0")
BUILD_TIME=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
GIT_HASH=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

cat > "$RELEASE_DIR/VERSION" <<EOF
TankGame Online
Version:    $VERSION
Build Time: $BUILD_TIME
Git Commit: $GIT_HASH
EOF

echo ""
echo "======================================"
echo "✅ 发布包构建完成!"
echo ""
echo "  输出目录: $RELEASE_DIR"
echo "  版本:     $VERSION ($GIT_HASH)"
echo ""
echo "  部署步骤:"
echo "  1. 将 release/ 目录整体拷贝到 Linux 服务器"
echo "     scp -r $RELEASE_DIR user@server:/opt/tankgame"
echo ""
echo "  2. 在服务器上执行安装脚本"
echo "     cd /opt/tankgame && bash install.sh"
echo "======================================"
