#!/usr/bin/env bash
#====================================================================
# TankGame Online - 一键启动脚本 (Linux/macOS)
#
# 功能: 自动检测环境 → 安装依赖 → 启动服务端 + 客户端
# 用法: bash scripts/start.sh
#====================================================================
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# --- 颜色定义 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   TankGame Online - One-Click Launcher   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ====== 1. 环境检查 ======
info "Checking environment..."

# Node.js
if ! command -v node &> /dev/null; then
  fail "Node.js not found. Please install Node.js >= 18.x from https://nodejs.org"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js >= 18 required, current: $(node -v)"
fi
ok "Node.js $(node -v)"

# pnpm
if ! command -v pnpm &> /dev/null; then
  warn "pnpm not found, installing via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate
fi
ok "pnpm $(pnpm -v)"

# ====== 2. 安装依赖 ======
info "Installing dependencies..."
pnpm install
ok "Dependencies installed"

# ====== 3. 启动服务 ======
info "Starting server on port 3000..."
setsid pnpm --filter @tankgame/server dev &> /dev/null &
SERVER_PID=$!

info "Starting client dev server on port 5173..."
setsid pnpm --filter @tankgame/client dev &> /dev/null &
CLIENT_PID=$!

# ====== 4. 等待服务就绪 ======
sleep 3
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         TankGame Online is READY!        ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  🎮 Open: http://localhost:5173           ║${NC}"
echo -e "${GREEN}║  🔧 API:  ws://localhost:3000             ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all services.      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ====== 5. 优雅退出 ======
cleanup() {
  echo ""
  info "Shutting down..."
  # 杀死整个进程组（包括 pnpm 和其子进程 node/tsx/vite）
  kill -- -$SERVER_PID 2>/dev/null || true
  kill -- -$CLIENT_PID 2>/dev/null || true
  # 备用：按端口查找残留进程
  for port in 3000 5173; do
    local pid
    pid=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
      kill -9 $pid 2>/dev/null || true
    fi
  done
  ok "All services stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT
wait
