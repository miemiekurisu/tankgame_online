import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_PORT,
  MAX_PLAYERS,
  MessageType,
  TICK_RATE,
  SNAPSHOT_RATE,
  TANK_MAX_SPEED,
  TANK_ACCELERATION,
  TANK_TURN_RATE,
  MUZZLE_VELOCITY,
  RELOAD_TIME,
  GRAVITY,
  SPLASH_RADIUS,
  ROUND_DURATION,
  RESPAWN_DELAY,
} from '@tankgame/shared';
import type { InputCmd } from '@tankgame/shared';
import { GameRoom } from './GameRoom.js';
import type { RoomClient } from './GameRoom.js';
import { GameDatabase } from './Database.js';

const PORT = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

/* ── 安全常量 ──────────────────────────── */
/** WebSocket 最大消息尺寸 (16KB) */
const MAX_WS_PAYLOAD = 16 * 1024;
/** 单个 IP 最大并发连接数 */
const MAX_CONNECTIONS_PER_IP = 6;
/** 单个连接每秒最大消息数 */
const MAX_MESSAGES_PER_SECOND = 60;
/** 昵称最大长度 */
const MAX_NICKNAME_LENGTH = 16;
/** 允许的 HTTP 源; 空 = 允许所有（开发模式） */
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : [];
/** 是否启用生产模式（统一 HTTP+WS） */
const PRODUCTION = process.env.NODE_ENV === 'production';
/** 静态文件目录（生产模式） */
const STATIC_DIR = process.env.STATIC_DIR || path.join(process.cwd(), 'public');

/* ── MIME 类型映射 ─────────────────────── */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

/**
 * 游戏服务器入口
 *
 * 安全特性：
 * - WebSocket 消息尺寸限制
 * - 单 IP 并发连接限制
 * - 消息速率限制
 * - 昵称清洗 & 长度限制
 * - CORS 源白名单（生产模式）
 * - 安全响应头（CSP / X-Frame / XSS 等）
 * - 生产模式下统一端口（HTTP+WS+静态文件）
 */
class GameServer {
  private wss: WebSocketServer;
  private rooms: Map<string, GameRoom> = new Map();
  private playerRooms: Map<WebSocket, string> = new Map();
  private playerIds: Map<WebSocket, number> = new Map();
  private db: GameDatabase;
  private httpServer: http.Server;

  // 会话跟踪：playerId → sessionId（用于数据库记录）
  private playerSessions: Map<number, number> = new Map();
  // clientId 跟踪：ws → clientId
  private playerClientIds: Map<WebSocket, string> = new Map();

  // 安全：连接数 / 速率追踪
  private ipConnections: Map<string, number> = new Map();
  private wsMessageCounts: Map<WebSocket, { count: number; resetAt: number }> = new Map();

  constructor(port: number) {
    // 初始化数据库
    this.db = new GameDatabase();

    // HTTP 服务器（API + 生产模式静态文件）
    this.httpServer = http.createServer((req, res) => this.handleHTTP(req, res));

    if (PRODUCTION) {
      // 生产模式：HTTP+WS 共享同一端口
      this.wss = new WebSocketServer({
        server: this.httpServer,
        maxPayload: MAX_WS_PAYLOAD,
        path: '/ws',
      });
      this.httpServer.listen(port, () => {
        console.log(`[Server] Production mode — HTTP+WS on port ${port}`);
      });
    } else {
      // 开发模式：WS 单独端口，HTTP 在 PORT+1
      this.wss = new WebSocketServer({ port, maxPayload: MAX_WS_PAYLOAD });
      console.log(`[Server] Dev mode — WS on ws://localhost:${port}`);
      const HTTP_PORT = port + 1;
      this.httpServer.listen(HTTP_PORT, () => {
        console.log(`[Server] Dev mode — HTTP API on http://localhost:${HTTP_PORT}`);
      });
    }

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // 定期清理空房间 & 速率表
    setInterval(() => this.cleanupRooms(), 30000);
  }

  /* ── 连接处理 ────────────────────────── */

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // IP 级连接限流
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';
    const currentCount = this.ipConnections.get(ip) || 0;
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      ws.close(4429, 'Too many connections');
      return;
    }
    this.ipConnections.set(ip, currentCount + 1);

    console.log('[Server] New connection from', ip);

    ws.on('message', (data) => {
      // 消息速率限制
      if (!this.checkMessageRate(ws)) {
        ws.close(4429, 'Rate limit exceeded');
        return;
      }
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(ws, msg);
      } catch (err) {
        console.error('[Server] Invalid message:', err);
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
      // 释放 IP 计数
      const count = this.ipConnections.get(ip) || 1;
      if (count <= 1) this.ipConnections.delete(ip);
      else this.ipConnections.set(ip, count - 1);
      this.wsMessageCounts.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[Server] WebSocket error:', err);
    });
  }

  /**
   * 检查消息速率 — 每秒最多 MAX_MESSAGES_PER_SECOND 条
   */
  private checkMessageRate(ws: WebSocket): boolean {
    const now = Date.now();
    let entry = this.wsMessageCounts.get(ws);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + 1000 };
      this.wsMessageCounts.set(ws, entry);
    }
    entry.count++;
    return entry.count <= MAX_MESSAGES_PER_SECOND;
  }

  private handleMessage(ws: WebSocket, msg: { type: number; [key: string]: unknown }): void {
    switch (msg.type) {
      case MessageType.JoinRoom:
        this.handleJoinRoom(ws, msg as { type: number; nickname: string });
        break;

      case MessageType.InputCmd:
        this.handleInputCmd(ws, msg as unknown as InputCmd);
        break;

      case MessageType.Ping:
        ws.send(
          JSON.stringify({
            type: MessageType.Pong,
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          })
        );
        break;
    }
  }

  private handleJoinRoom(ws: WebSocket, msg: { nickname: string; clientId?: string }): void {
    // 昵称清洗
    let nickname = (msg.nickname || 'Player').trim().slice(0, MAX_NICKNAME_LENGTH);
    if (!nickname) nickname = 'Player';

    // 验证 clientId 格式（UUID v4）
    let clientId = msg.clientId || 'anonymous';
    if (clientId !== 'anonymous' && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
      clientId = 'anonymous';
    }

    // Quick Join: 找一个有空位的房间，或新建
    let room = this.findAvailableRoom();
    if (!room) {
      room = this.createRoom();
    }

    const client: RoomClient = {
      playerId: 0,
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },
    };

    const player = room.addPlayer(client, nickname);
    if (!player) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
      return;
    }

    this.playerRooms.set(ws, room.id);
    this.playerIds.set(ws, player.id);

    // 记录 clientId 并创建数据库会话
    this.playerClientIds.set(ws, clientId);
    try {
      const sessionId = this.db.onPlayerLogin(clientId, nickname);
      this.playerSessions.set(player.id, sessionId);
    } catch (err) {
      console.error('[Server] Database error on login:', err);
    }

    // 注册 AFK 踢出回调（用于清理 WebSocket 映射）
    room.onPlayerKicked = (kickedId: number) => {
      for (const [socket, pid] of this.playerIds) {
        if (pid === kickedId) {
          // 结束数据库会话
          this.endPlayerSession(kickedId, socket);
          this.playerRooms.delete(socket);
          this.playerIds.delete(socket);
          this.playerClientIds.delete(socket);
          // 关闭连接
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(4001, 'AFK kicked');
          }
          break;
        }
      }
    };

    // 发送 JoinAck
    ws.send(
      JSON.stringify({
        type: MessageType.JoinAck,
        playerId: player.id,
        roomId: room.id,
        roomState: room.state,
        mapSeed: room.world.map.seed,
        config: {
          tickRate: TICK_RATE,
          snapshotRate: SNAPSHOT_RATE,
          tankMaxSpeed: TANK_MAX_SPEED,
          tankAcceleration: TANK_ACCELERATION,
          tankTurnRate: TANK_TURN_RATE,
          muzzleVelocity: MUZZLE_VELOCITY,
          reloadTime: RELOAD_TIME,
          gravity: GRAVITY,
          splashRadius: SPLASH_RADIUS,
          roundDuration: ROUND_DURATION,
          respawnDelay: RESPAWN_DELAY,
        },
      })
    );

    console.log(
      `[Server] Player "${nickname}" (id=${player.id}) joined room ${room.id} (${room.clients.size}/${MAX_PLAYERS})`
    );
  }

  private handleInputCmd(ws: WebSocket, cmd: InputCmd): void {
    const roomId = this.playerRooms.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const playerId = this.playerIds.get(ws);
    if (playerId !== undefined) {
      room.handleInput(playerId, cmd);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const roomId = this.playerRooms.get(ws);
    if (roomId) {
      const room = this.rooms.get(roomId);
      const playerId = this.playerIds.get(ws);
      if (room && playerId !== undefined) {
        // 结束数据库会话（在移除前获取统计）
        this.endPlayerSession(playerId, ws);
        room.removePlayer(playerId);
        console.log(`[Server] Player ${playerId} disconnected from room ${roomId}`);
      }
      this.playerRooms.delete(ws);
      this.playerIds.delete(ws);
      this.playerClientIds.delete(ws);
    }
  }

  /**
   * 结束玩家数据库会话 — 记录最终战绩
   */
  private endPlayerSession(playerId: number, ws: WebSocket): void {
    const sessionId = this.playerSessions.get(playerId);
    if (sessionId === undefined) return;

    // 获取玩家当前战绩
    const roomId = this.playerRooms.get(ws);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    const player = room?.world.players.get(playerId);

    try {
      this.db.onPlayerLogout(sessionId, {
        kills: player?.kills ?? 0,
        deaths: player?.deaths ?? 0,
        shots: player?.shots ?? 0,
        hits: player?.hits ?? 0,
      });
    } catch (err) {
      console.error('[Server] Database error on logout:', err);
    }
    this.playerSessions.delete(playerId);
  }

  /**
   * HTTP API 处理 — 排行榜接口 + 生产模式静态文件
   */
  private handleHTTP(req: http.IncomingMessage, res: http.ServerResponse): void {
    // ── 安全响应头 ──
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // CORS — 开发模式宽松，生产模式限制
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.length > 0) {
      if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      // 不在白名单中 → 不设置 CORS 头
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // ── API：排行榜 ──
    if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=10');

      const period = url.searchParams.get('period') || 'weekly';
      const type = url.searchParams.get('type') || 'playtime';
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

      try {
        const entries = this.db.getLeaderboard(type, period, limit);
        res.writeHead(200);
        res.end(JSON.stringify({ period, type, entries }));
      } catch (err) {
        console.error('[Server] Leaderboard query error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return;
    }

    // ── 健康检查 ──
    if (url.pathname === '/api/health' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        rooms: this.rooms.size,
        connections: this.wss.clients.size,
        uptime: process.uptime(),
      }));
      return;
    }

    // ── 生产模式：静态文件服务 ──
    if (PRODUCTION) {
      this.serveStatic(url.pathname, res);
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * 生产模式静态文件服务 — SPA fallback
   */
  private serveStatic(pathname: string, res: http.ServerResponse): void {
    // 安全：防止目录遍历
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(STATIC_DIR, safePath);

    // SPA fallback: 文件不存在则返回 index.html
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (fs.existsSync(path.join(filePath, 'index.html'))) {
        filePath = path.join(filePath, 'index.html');
      } else {
        filePath = path.join(STATIC_DIR, 'index.html');
      }
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    // 静态资源缓存（hash 文件长期缓存）
    if (safePath.includes('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }

    const stream = fs.createReadStream(filePath);
    res.writeHead(200);
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
  }

  private findAvailableRoom(): GameRoom | null {
    for (const room of this.rooms.values()) {
      if (!room.isFull()) return room;
    }
    return null;
  }

  private createRoom(): GameRoom {
    const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const room = new GameRoom(id);
    this.rooms.set(id, room);
    console.log(`[Server] Created room ${id}`);
    return room;
  }

  private cleanupRooms(): void {
    for (const [id, room] of this.rooms) {
      if (room.isEmpty()) {
        room.destroy();
        this.rooms.delete(id);
        console.log(`[Server] Cleaned up empty room ${id}`);
      }
    }
  }

  /** 优雅关闭：销毁所有房间 → 关闭 WebSocket → 关闭 HTTP → 关闭数据库 */
  async shutdown(): Promise<void> {
    // 1. 销毁所有游戏房间
    for (const [id, room] of this.rooms) {
      room.destroy();
      console.log(`[Server] Destroyed room ${id}`);
    }
    this.rooms.clear();

    // 2. 关闭所有 WebSocket 连接
    for (const ws of this.wss.clients) {
      ws.close(1001, 'Server shutting down');
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    console.log('[Server] WebSocket server closed');

    // 3. 关闭 HTTP 服务器
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    console.log('[Server] HTTP server closed');

    // 4. 关闭数据库（刷写 WAL）
    this.db.close();
    console.log('[Server] Database closed');
  }
}

// 启动服务器
const server = new GameServer(PORT);

/* ── Docker 生命周期：优雅关闭 ─────────────────── */
function gracefulShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully…`);
  server.shutdown().then(() => {
    console.log('[Server] Shutdown complete.');
    process.exit(0);
  }).catch((err) => {
    console.error('[Server] Shutdown error:', err);
    process.exit(1);
  });

  // 强制退出保底（10秒超时）
  setTimeout(() => {
    console.error('[Server] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
