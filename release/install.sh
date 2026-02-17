#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# TankGame Online — Linux 服务器一键安装部署脚本
#
# 功能:
#   1. 检查系统环境（OS / 架构 / 内存 / 磁盘）
#   2. 检查并安装 Docker + Docker Compose
#   3. 构建 Docker 镜像
#   4. 启动游戏服务
#
# 用法:
#   bash install.sh              # 完整安装部署
#   bash install.sh check        # 仅检查环境
#   bash install.sh build        # 仅构建镜像
#   bash install.sh start        # 启动服务
#   bash install.sh stop         # 停止服务
#   bash install.sh restart      # 重启服务
#   bash install.sh status       # 查看状态
#   bash install.sh logs         # 查看日志
#   bash install.sh uninstall    # 卸载（停止并删除镜像）
# ══════════════════════════════════════════════════════════════
set -euo pipefail

# ── 配置 ──────────────────────────────────────
IMAGE_NAME="tankgame-online"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="tankgame-server"
PORT="${PORT:-3000}"
MIN_MEMORY_MB=512
MIN_DISK_MB=2048

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── 工具函数 ──────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[FAIL]${NC}  $*"; }
step()    { echo -e "\n${CYAN}${BOLD}▸ $*${NC}"; }

cd "$(dirname "$0")"
INSTALL_DIR="$(pwd)"

# ══════════════════════════════════════════════
# 环境检查
# ══════════════════════════════════════════════
check_environment() {
  local has_error=0

  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo -e "${BOLD}  TankGame Online — 环境检查${NC}"
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo ""

  # ── 操作系统 ──
  step "检查操作系统"
  if [[ "$(uname -s)" != "Linux" ]]; then
    error "此脚本仅支持 Linux 系统 (当前: $(uname -s))"
    echo "  请在 Linux 服务器上运行此脚本"
    has_error=1
  else
    local distro="未知"
    if [ -f /etc/os-release ]; then
      distro=$(. /etc/os-release && echo "$PRETTY_NAME")
    elif [ -f /etc/redhat-release ]; then
      distro=$(cat /etc/redhat-release)
    fi
    success "Linux — $distro"
  fi

  # ── CPU 架构 ──
  step "检查 CPU 架构"
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64)   success "x86_64 (amd64)" ;;
    aarch64|arm64)   success "aarch64 (arm64)" ;;
    *)
      warn "架构 $arch 未经测试，可能遇到兼容性问题"
      ;;
  esac

  # ── 内存 ──
  step "检查内存"
  if command -v free &>/dev/null; then
    local total_mem_mb
    total_mem_mb=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$total_mem_mb" -lt "$MIN_MEMORY_MB" ]; then
      error "内存不足: ${total_mem_mb}MB (最低要求: ${MIN_MEMORY_MB}MB)"
      has_error=1
    else
      success "总内存: ${total_mem_mb}MB (最低要求: ${MIN_MEMORY_MB}MB)"
    fi
  else
    warn "无法检测内存 (缺少 free 命令)"
  fi

  # ── 磁盘空间 ──
  step "检查磁盘空间"
  local avail_mb
  avail_mb=$(df -m "$INSTALL_DIR" | awk 'NR==2{print $4}')
  if [ "$avail_mb" -lt "$MIN_DISK_MB" ]; then
    error "磁盘空间不足: ${avail_mb}MB (最低要求: ${MIN_DISK_MB}MB)"
    has_error=1
  else
    success "可用空间: ${avail_mb}MB (最低要求: ${MIN_DISK_MB}MB)"
  fi

  # ── Docker ──
  step "检查 Docker"
  if command -v docker &>/dev/null; then
    local docker_ver
    docker_ver=$(docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "未知")
    success "Docker 已安装 (版本: $docker_ver)"

    # 检查 Docker 服务状态
    if docker info &>/dev/null; then
      success "Docker 服务正在运行"
    else
      warn "Docker 已安装但服务未运行或当前用户无权限"
      echo "  修复方法:"
      echo "    sudo systemctl start docker"
      echo "    sudo usermod -aG docker \$USER  # 然后重新登录"
    fi
  else
    warn "Docker 未安装"
    echo "  安装脚本将自动安装 Docker"
  fi

  # ── Docker Compose ──
  step "检查 Docker Compose"
  if docker compose version &>/dev/null 2>&1; then
    local compose_ver
    compose_ver=$(docker compose version --short 2>/dev/null || echo "未知")
    success "Docker Compose 已安装 (版本: $compose_ver)"
  elif command -v docker-compose &>/dev/null; then
    local compose_ver
    compose_ver=$(docker-compose --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "未知")
    success "docker-compose 已安装 (版本: $compose_ver)"
    warn "建议升级到 Docker Compose V2 (docker compose)"
  else
    warn "Docker Compose 未安装"
    echo "  安装脚本将自动安装 Docker Compose"
  fi

  # ── 端口占用 ──
  step "检查端口 ${PORT}"
  if command -v ss &>/dev/null; then
    if ss -tlnp | grep -q ":${PORT} "; then
      warn "端口 ${PORT} 已被占用"
      echo "  占用进程:"
      ss -tlnp | grep ":${PORT} " | head -3
      echo "  可通过 PORT=其他端口 bash install.sh 更换端口"
    else
      success "端口 ${PORT} 可用"
    fi
  elif command -v netstat &>/dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
      warn "端口 ${PORT} 已被占用"
    else
      success "端口 ${PORT} 可用"
    fi
  else
    warn "无法检查端口 (缺少 ss/netstat)"
  fi

  # ── 必需文件 ──
  step "检查部署文件完整性"
  local required_files=(
    "Dockerfile"
    "docker-compose.yml"
    "package.json"
    "pnpm-lock.yaml"
    "pnpm-workspace.yaml"
    "tsconfig.base.json"
    "packages/shared/package.json"
    "packages/shared/src/index.ts"
    "packages/server/package.json"
    "packages/server/src/index.ts"
    "packages/client/package.json"
    "packages/client/index.html"
    "packages/client/vite.config.ts"
  )
  local missing=0
  for f in "${required_files[@]}"; do
    if [ ! -f "$INSTALL_DIR/$f" ]; then
      error "缺少文件: $f"
      missing=$((missing + 1))
    fi
  done
  if [ "$missing" -eq 0 ]; then
    success "所有必需文件完整 (${#required_files[@]} 个)"
  else
    error "缺少 $missing 个文件，请确保 release 包完整"
    has_error=1
  fi

  # ── 总结 ──
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  if [ "$has_error" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}✅ 环境检查通过${NC}"
  else
    echo -e "  ${RED}${BOLD}❌ 环境检查发现问题，请先修复上述错误${NC}"
  fi
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo ""

  return $has_error
}

# ══════════════════════════════════════════════
# 安装 Docker
# ══════════════════════════════════════════════
install_docker() {
  if command -v docker &>/dev/null && docker info &>/dev/null; then
    info "Docker 已安装并正在运行，跳过安装"
    return 0
  fi

  step "安装 Docker"

  # 检测包管理器并安装
  if [ -f /etc/debian_version ]; then
    # Debian / Ubuntu
    info "检测到 Debian/Ubuntu 系统"
    sudo apt-get update -qq
    sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release

    # 添加 Docker 官方 GPG 密钥
    sudo install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
    fi

    # 添加 Docker 仓库
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
    # CentOS / RHEL / Fedora
    info "检测到 RHEL/CentOS 系统"
    sudo yum install -y yum-utils
    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

  elif [ -f /etc/arch-release ]; then
    info "检测到 Arch Linux"
    sudo pacman -Sy --noconfirm docker docker-compose

  else
    error "无法自动安装 Docker — 不支持的 Linux 发行版"
    echo ""
    echo "  请手动安装 Docker:"
    echo "    https://docs.docker.com/engine/install/"
    echo ""
    echo "  安装完成后重新运行: bash install.sh"
    return 1
  fi

  # 启动 Docker 服务
  sudo systemctl enable docker
  sudo systemctl start docker

  # 将当前用户加入 docker 组
  if ! groups | grep -q docker; then
    sudo usermod -aG docker "$USER"
    warn "已将用户 $USER 加入 docker 组"
    warn "可能需要重新登录后才能免 sudo 使用 docker"
  fi

  success "Docker 安装完成"
}

# ══════════════════════════════════════════════
# 构建镜像
# ══════════════════════════════════════════════
build_image() {
  step "构建 Docker 镜像: ${IMAGE_NAME}:${IMAGE_TAG}"

  if ! command -v docker &>/dev/null; then
    error "Docker 未安装，请先运行: bash install.sh"
    return 1
  fi

  cd "$INSTALL_DIR"
  docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

  local image_size
  image_size=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format '{{.Size}}' 2>/dev/null || echo "未知")
  success "镜像构建完成 (大小: ${image_size})"
}

# ══════════════════════════════════════════════
# 启动服务
# ══════════════════════════════════════════════
start_service() {
  step "启动 TankGame 服务 (端口: ${PORT})"

  cd "$INSTALL_DIR"

  # 检查镜像是否存在
  if ! docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format '{{.ID}}' | grep -q .; then
    warn "镜像不存在，先进行构建..."
    build_image
  fi

  PORT="$PORT" docker compose up -d

  # 等待健康检查
  info "等待服务启动..."
  local retries=0
  local max_retries=30
  while [ $retries -lt $max_retries ]; do
    if docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "healthy"; then
      break
    fi
    # 也检查容器是否在运行（可能还没有健康检查结果）
    if [ $retries -ge 5 ]; then
      if docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "running"; then
        # 容器在运行，尝试直接访问
        if curl -sf "http://localhost:${PORT}/api/health" &>/dev/null; then
          break
        fi
      fi
    fi
    sleep 2
    retries=$((retries + 1))
  done

  if curl -sf "http://localhost:${PORT}/api/health" &>/dev/null; then
    success "服务已启动并通过健康检查"
  else
    warn "服务已启动但健康检查未响应（可能仍在初始化）"
  fi

  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo -e "  ${GREEN}${BOLD}🎮 TankGame Online 已就绪!${NC}"
  echo ""
  echo -e "  游戏地址:   ${CYAN}http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${PORT}${NC}"
  echo -e "  本机访问:   ${CYAN}http://localhost:${PORT}${NC}"
  echo -e "  健康检查:   ${CYAN}http://localhost:${PORT}/api/health${NC}"
  echo ""
  echo -e "  查看日志:   bash install.sh logs"
  echo -e "  停止服务:   bash install.sh stop"
  echo -e "  重启服务:   bash install.sh restart"
  echo -e "  查看状态:   bash install.sh status"
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
}

# ══════════════════════════════════════════════
# 停止服务
# ══════════════════════════════════════════════
stop_service() {
  step "停止服务..."
  cd "$INSTALL_DIR"
  docker compose down
  success "服务已停止"
}

# ══════════════════════════════════════════════
# 查看状态
# ══════════════════════════════════════════════
show_status() {
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo -e "${BOLD}  TankGame Online — 服务状态${NC}"
  echo -e "${BOLD}══════════════════════════════════════════${NC}"
  echo ""

  # 容器状态
  if docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Status}}' 2>/dev/null | grep -q .; then
    local status
    status=$(docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Status}}')
    success "容器运行中: $status"

    # 健康检查
    if curl -sf "http://localhost:${PORT}/api/health" 2>/dev/null; then
      echo ""
      success "API 健康检查通过"
    fi

    # 资源使用
    echo ""
    info "资源使用:"
    docker stats --no-stream --format "  CPU: {{.CPUPerc}}  内存: {{.MemUsage}}" "$CONTAINER_NAME" 2>/dev/null || true
  else
    warn "容器未运行"
    echo "  启动: bash install.sh start"
  fi

  # 镜像信息
  echo ""
  info "镜像信息:"
  docker images "${IMAGE_NAME}" --format "  ${IMAGE_NAME}:{{.Tag}}  大小: {{.Size}}  创建: {{.CreatedSince}}" 2>/dev/null || echo "  无镜像"

  # 数据卷
  echo ""
  info "数据卷:"
  docker volume ls --filter "name=tankgame" --format "  {{.Name}}  驱动: {{.Driver}}" 2>/dev/null || echo "  无数据卷"

  echo ""
}

# ══════════════════════════════════════════════
# 卸载
# ══════════════════════════════════════════════
uninstall_service() {
  echo ""
  warn "即将卸载 TankGame Online"
  echo "  这将停止容器并删除镜像"
  echo "  数据卷（数据库）将被保留"
  echo ""
  read -rp "确认卸载? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    info "取消卸载"
    return 0
  fi

  step "停止并移除容器..."
  cd "$INSTALL_DIR"
  docker compose down 2>/dev/null || true

  step "删除镜像..."
  docker rmi "${IMAGE_NAME}:${IMAGE_TAG}" 2>/dev/null || true

  success "卸载完成"
  echo ""
  info "数据卷已保留，如需彻底删除数据:"
  echo "  docker volume rm tankgame-data   # 删除游戏数据库"
  echo "  rm -rf $INSTALL_DIR              # 删除部署文件"
}

# ══════════════════════════════════════════════
# 完整安装流程
# ══════════════════════════════════════════════
full_install() {
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  🎮 TankGame Online — 一键安装部署${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════${NC}"
  echo ""
  echo "  端口: ${PORT}"
  echo "  目录: ${INSTALL_DIR}"
  echo ""

  # 步骤 1: 环境检查
  echo -e "${BOLD}━━━ 步骤 1/4: 环境检查 ━━━${NC}"
  # 允许非致命通过（Docker 缺失会在下一步安装）
  check_environment || true

  # 步骤 2: 安装 Docker
  echo -e "\n${BOLD}━━━ 步骤 2/4: Docker 环境 ━━━${NC}"
  install_docker

  # 步骤 3: 构建镜像
  echo -e "\n${BOLD}━━━ 步骤 3/4: 构建镜像 ━━━${NC}"
  build_image

  # 步骤 4: 启动服务
  echo -e "\n${BOLD}━━━ 步骤 4/4: 启动服务 ━━━${NC}"
  start_service
}

# ══════════════════════════════════════════════
# 帮助信息
# ══════════════════════════════════════════════
show_help() {
  echo ""
  echo -e "${BOLD}TankGame Online — 部署管理脚本${NC}"
  echo ""
  echo "用法: bash install.sh [命令]"
  echo ""
  echo "命令:"
  echo "  (无参数)    完整安装部署（检查环境 → 安装 Docker → 构建 → 启动）"
  echo "  check       仅检查系统环境是否满足要求"
  echo "  build       仅构建 Docker 镜像"
  echo "  start       启动服务"
  echo "  stop        停止服务"
  echo "  restart     重启服务"
  echo "  status      查看服务状态与资源使用"
  echo "  logs        查看实时日志"
  echo "  uninstall   卸载（停止容器 + 删除镜像）"
  echo "  help        显示此帮助"
  echo ""
  echo "环境变量:"
  echo "  PORT=3000        游戏服务端口（默认 3000）"
  echo "  IMAGE_TAG=latest 镜像标签（默认 latest）"
  echo ""
  echo "示例:"
  echo "  bash install.sh                    # 一键安装"
  echo "  PORT=8080 bash install.sh          # 使用 8080 端口"
  echo "  bash install.sh check              # 仅检查环境"
  echo "  bash install.sh logs               # 查看日志"
  echo ""
}

# ══════════════════════════════════════════════
# 主入口
# ══════════════════════════════════════════════
case "${1:-}" in
  check)      check_environment ;;
  build)      build_image ;;
  start)      start_service ;;
  stop)       stop_service ;;
  restart)
    step "重启服务..."
    cd "$INSTALL_DIR"
    docker compose restart
    success "服务已重启"
    ;;
  status)     show_status ;;
  logs)
    cd "$INSTALL_DIR"
    docker compose logs -f --tail=200
    ;;
  uninstall)  uninstall_service ;;
  help|-h|--help)
    show_help
    ;;
  "")
    full_install
    ;;
  *)
    error "未知命令: $1"
    show_help
    exit 1
    ;;
esac
