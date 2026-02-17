#!/usr/bin/env bash
# ──────────────────────────────────────────────
# TankGame Online — 一键构建 & 启动 Docker 镜像
# 用法:
#   ./scripts/docker-deploy.sh              # 构建并启动
#   ./scripts/docker-deploy.sh build        # 仅构建镜像
#   ./scripts/docker-deploy.sh start        # 启动已有镜像
#   ./scripts/docker-deploy.sh stop         # 停止服务
#   ./scripts/docker-deploy.sh logs         # 查看日志
#   ./scripts/docker-deploy.sh restart      # 重启服务
# ──────────────────────────────────────────────
set -euo pipefail

IMAGE_NAME="tankgame-online"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="tankgame-server"
PORT="${PORT:-3000}"

cd "$(dirname "$0")/.."

case "${1:-deploy}" in
  build)
    echo "🔨 构建 Docker 镜像: ${IMAGE_NAME}:${IMAGE_TAG}"
    docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .
    echo "✅ 镜像构建完成"
    ;;

  start)
    echo "🚀 启动容器: ${CONTAINER_NAME} (端口 ${PORT})"
    docker compose up -d
    echo "✅ 服务已启动: http://localhost:${PORT}"
    ;;

  stop)
    echo "⏹ 停止服务..."
    docker compose down
    echo "✅ 服务已停止"
    ;;

  restart)
    echo "🔄 重启服务..."
    docker compose restart
    echo "✅ 服务已重启"
    ;;

  logs)
    docker compose logs -f --tail=100
    ;;

  deploy|"")
    echo "=============================="
    echo "  TankGame Online Docker 部署"
    echo "=============================="
    echo ""
    echo "🔨 步骤 1/2: 构建镜像..."
    docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .
    echo ""
    echo "🚀 步骤 2/2: 启动服务..."
    docker compose up -d
    echo ""
    echo "=============================="
    echo "✅ 部署完成!"
    echo "   游戏地址: http://localhost:${PORT}"
    echo "   健康检查: http://localhost:${PORT}/api/health"
    echo "   查看日志: ./scripts/docker-deploy.sh logs"
    echo "   停止服务: ./scripts/docker-deploy.sh stop"
    echo "=============================="
    ;;

  *)
    echo "用法: $0 {build|start|stop|restart|logs|deploy}"
    exit 1
    ;;
esac
